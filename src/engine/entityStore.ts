// ---- What a save has to send, and in what order ----
//
// Two clients write to `budget_entities` now. The *rules* about how —
// which rows, with which version guard, in which order, and when to stop —
// must not exist twice: the web and the phone drifting apart on write
// ordering is a data-loss bug that would show up as "it works on my
// laptop". So the plan is computed here, pure and tested, and each client
// does nothing but execute it against its own Supabase client.
//
// This file knows nothing about Supabase, React or fetch. `storage.js` and
// `mobile/lib/store.ts` are the only places that do.
import { diffEntities, tombstoneAlarm } from "./entities.ts";
import type { Entity, EntityRef } from "./entities.ts";

/** The version counter we hold for a row, keyed "kind:id". */
export type VersionMap = ReadonlyMap<string, number>;

export const keyOf = (e: { kind: string; id: string }): string => `${e.kind}:${e.id}`;

export type WriteOp =
  /** No version held: this row is new to us. A unique-violation on insert
   *  means it appeared since we loaded — a conflict, never a force. */
  | { op: "insert"; entity: Entity }
  /** Conditional on `version`; zero rows matched means somebody else wrote. */
  | { op: "update"; entity: Entity; version: number }
  /** A delete is `set deleted_at`, never a DELETE: a row that is simply
   *  absent cannot outrank a stale device's copy of it. */
  | { op: "tombstone"; ref: EntityRef; version: number | null };

export interface WritePlan {
  ops: WriteOp[];
  /** True when this save would remove most of what is stored. The
   *  entity-level heir to the old whole-document empty-state alarm, which
   *  stands where a real data-loss incident already happened. Callers log
   *  it loudly and still proceed — wiping your own account looks exactly
   *  like this and is legitimate. */
  alarm: boolean;
}

/**
 * UPSERTS BEFORE TOMBSTONES, and the caller aborts on the first refusal.
 * These are separate statements rather than one transaction, so a conflict
 * part-way leaves the rows that already landed; ordering it this way means
 * a conflict stops before anything is REMOVED. Losing an edit is
 * recoverable — the caller stashes a recovery copy and adopts the server's
 * state — while a tombstone written on a stale view is not.
 *
 * `baseline` is always the last assembled-and-normalized state, never raw
 * rows: normalize() seeds a snapshot for an account with none and mints
 * default categories for a new account, so diffing raw rows would make
 * every load write phantom rows it never had.
 */
export function planWrite(baseline: Entity[], next: Entity[], versions: VersionMap): WritePlan {
  const diff = diffEntities(baseline, next);
  const ops: WriteOp[] = [];

  for (const entity of diff.upserts) {
    const version = versions.get(keyOf(entity));
    if (version === undefined) ops.push({ op: "insert", entity });
    else ops.push({ op: "update", entity, version });
  }
  for (const ref of diff.tombstones) {
    ops.push({ op: "tombstone", ref, version: versions.get(keyOf(ref)) ?? null });
  }

  return { ops, alarm: tombstoneAlarm(baseline, diff) };
}

/** Apply one op's result to the version map. Keeps both clients' bookkeeping
 *  identical — a version map that drifts turns every later write into a
 *  spurious conflict. */
export function applyResult(
  versions: Map<string, number>,
  op: WriteOp,
  newVersion: number | null
): void {
  if (op.op === "tombstone") versions.delete(keyOf(op.ref));
  else if (newVersion != null) versions.set(keyOf(op.entity), newVersion);
}
