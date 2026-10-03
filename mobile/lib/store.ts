// Loading state on the phone, through the SAME engine the web app uses.
//
// Nothing here knows what a budget is. It reads entity rows, hands them to
// assembleState, and hands the result to normalize — both imported from
// ../../src/engine, not reimplemented. That is the whole point of keeping
// the engine free of React, network and DOM: the money math has one
// implementation and two clients.
import { supabase } from "./supabase";
import { assembleState } from "../../src/engine/entities.ts";
import { normalize } from "../../src/engine/stateShape.ts";
import type { BudgetState } from "../../src/engine/types.ts";

/**
 * READ ONLY, deliberately, for this build. The per-entity write path with
 * its version guards is real work, and shipping it the same night the
 * production data moved would risk the phone writing bad rows into a
 * freshly migrated database to answer a question — "does this feel like an
 * app" — that writing does not help answer.
 */
export async function loadState(userId: string): Promise<BudgetState> {
  const { data, error } = await supabase
    .from("budget_entities")
    .select("kind,entity_id,data,schema_version")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) throw new Error(error.message);

  // A row stamped higher than this build understands means an older app
  // meeting newer data. Refuse rather than render something half-read.
  const MAX_SCHEMA = 1;
  const tooNew = (data ?? []).find((r) => r.schema_version > MAX_SCHEMA);
  if (tooNew) {
    throw new Error(
      `This version of the app is too old to read your data (row schema ${tooNew.schema_version}). Update from the App Store.`
    );
  }

  return normalize(
    assembleState(
      (data ?? []).map((r) => ({
        kind: r.kind,
        id: r.entity_id,
        data: r.data,
        schemaVersion: r.schema_version,
      }))
    )
  );
}
