// Loading AND saving on the phone, through the same engine and the same
// write plan as the web.
//
// Nothing here decides anything about budgets or about write ordering. It
// reads rows, hands them to assembleState and normalize, and executes the
// ops planWrite returns. The rules — which rows, which guard, what order,
// when to stop — live in engine/entityStore.ts precisely so the two
// clients cannot drift: a phone and a laptop disagreeing about write order
// is a data-loss bug that reads as "works on my laptop".
import { supabase } from "./supabase";
import { assembleState, splitState } from "../../src/engine/entities.ts";
import { planWrite, applyResult } from "../../src/engine/entityStore.ts";
import { normalize } from "../../src/engine/stateShape.ts";
import type { BudgetState } from "../../src/engine/types.ts";
import type { Entity } from "../../src/engine/entities.ts";

const MAX_SCHEMA = 1;

// Per-user bookkeeping, same shape as storage.js. Held in memory only: a
// version map persisted across launches would be stale on arrival, and a
// stale guard is worse than no guard — it turns a conflict into a silent
// overwrite the next time the counters happen to line up.
let currentUserId: string | null = null;
let versions = new Map<string, number>();
let baseline: Entity[] = [];

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: "conflict" | "offline" | "error"; message?: string };

export function resetStore() {
  currentUserId = null;
  versions = new Map();
  baseline = [];
}

export async function loadState(userId: string): Promise<BudgetState> {
  const { data, error } = await supabase
    .from("budget_entities")
    .select("kind,entity_id,data,version,schema_version")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) throw new Error(error.message);

  // An older build meeting newer data: refuse rather than render half of
  // it. App Store builds lag; the web app never does.
  const tooNew = (data ?? []).find((r) => r.schema_version > MAX_SCHEMA);
  if (tooNew) {
    throw new Error(
      `This version of the app is too old to read your data (row schema ${tooNew.schema_version}). Update from the App Store.`
    );
  }

  currentUserId = userId;
  versions = new Map((data ?? []).map((r) => [`${r.kind}:${r.entity_id}`, r.version]));

  const state = normalize(
    assembleState((data ?? []).map((r) => ({
      kind: r.kind, id: r.entity_id, data: r.data, schemaVersion: r.schema_version,
    })))
  );
  // The baseline is the ASSEMBLED-AND-NORMALIZED state, never the raw rows:
  // normalize() seeds a snapshot for an account with none and mints default
  // categories for a new account, so diffing raw rows would make every load
  // write phantom rows it never had.
  baseline = splitState(state);
  return state;
}

/**
 * Save. Returns a result rather than throwing, because the caller has to
 * SHOW the failure — a write that does not land has to say so, and on a
 * phone "it silently didn't save" is the worst possible outcome.
 */
export async function saveState(userId: string, state: BudgetState): Promise<SaveResult> {
  if (userId !== currentUserId) return { ok: false, reason: "error", message: "Not loaded" };

  const next = splitState(state);
  const { ops, alarm } = planWrite(baseline, next, versions);
  if (ops.length === 0) return { ok: true };
  if (alarm) {
    console.warn(`This save removes ${ops.filter((o) => o.op === "tombstone").length} of ${baseline.length} rows.`);
  }

  for (const op of ops) {
    try {
      if (op.op === "insert") {
        const { data, error } = await supabase
          .from("budget_entities")
          .insert({
            user_id: userId, kind: op.entity.kind, entity_id: op.entity.id,
            data: op.entity.data, schema_version: op.entity.schemaVersion,
          })
          .select("version").maybeSingle();
        if (error) {
          if (error.code !== "23505") {
            return { ok: false, reason: netish(error) ? "offline" : "error", message: error.message };
          }
          // A TOMBSTONE still occupies the primary key and we never load
          // tombstones, so we hold no version and planned an insert.
          // Revive it; only a collision with a LIVE row is a real conflict.
          const revived = await supabase
            .from("budget_entities")
            .update({ data: op.entity.data, schema_version: op.entity.schemaVersion, deleted_at: null })
            .eq("user_id", userId).eq("kind", op.entity.kind).eq("entity_id", op.entity.id)
            .not("deleted_at", "is", null)
            .select("version").maybeSingle();
          if (revived.error) return { ok: false, reason: "error", message: revived.error.message };
          if (!revived.data) return { ok: false, reason: "conflict" };
          applyResult(versions, op, revived.data.version);
          continue;
        }
        applyResult(versions, op, data!.version);
      } else if (op.op === "update") {
        const { data, error } = await supabase
          .from("budget_entities")
          .update({ data: op.entity.data, schema_version: op.entity.schemaVersion, deleted_at: null })
          .eq("user_id", userId).eq("kind", op.entity.kind).eq("entity_id", op.entity.id)
          .eq("version", op.version)
          .select("version").maybeSingle();
        if (error) return { ok: false, reason: netish(error) ? "offline" : "error", message: error.message };
        if (!data) return { ok: false, reason: "conflict" };
        applyResult(versions, op, data.version);
      } else {
        let q = supabase
          .from("budget_entities")
          .update({ deleted_at: new Date().toISOString() })
          .eq("user_id", userId).eq("kind", op.ref.kind).eq("entity_id", op.ref.id);
        if (op.version != null) q = q.eq("version", op.version);
        const { data, error } = await q.select("version").maybeSingle();
        if (error) return { ok: false, reason: netish(error) ? "offline" : "error", message: error.message };
        if (!data) return { ok: false, reason: "conflict" };
        applyResult(versions, op, null);
      }
    } catch (err) {
      // A dropped connection mid-request throws rather than returning an
      // error object. Partial application is possible and acceptable here:
      // nothing has been tombstoned yet, because upserts are planned first.
      return { ok: false, reason: "offline", message: (err as Error).message };
    }
  }

  baseline = next;
  return { ok: true };
}

// supabase-js surfaces a lost connection as a fetch failure with no code.
const netish = (e: { code?: string; message?: string }) =>
  !e.code && /fetch|network|timeout|Load failed/i.test(e.message ?? "");
