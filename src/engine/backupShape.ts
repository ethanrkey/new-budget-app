// ---- Pure validation/summary helpers for a full JSON backup restore ----
// Split out of ImportCSV.jsx so this is testable from plain Node (that file
// has JSX, which Node can't parse directly) — same reasoning as
// stateShape.js being split out of storage.js.
import type { BalanceSnapshot, MonthKey, RawState } from "./types.ts";

/**
 * The bare minimum that says "this is plausibly one of our own state
 * backups," not just any JSON file someone picked by mistake. Deliberately
 * loose beyond that — normalize() (the same function every normal load
 * already goes through) fills in everything else and migrates old shapes,
 * so a backup from an earlier version of the app restores just as safely
 * as loading it normally would.
 *
 * The return type is a type predicate so a caller that has checked a blob can
 * then read `recurring`/`oneoffs` off it without re-asserting.
 */
export function isPlausibleBackup(obj: unknown): obj is RawState {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return Array.isArray(o.recurring) && Array.isArray(o.oneoffs);
}

export function countSnapshots(
  balanceSnapshots: Record<string, BalanceSnapshot[]> | null | undefined
): number {
  return Object.values(balanceSnapshots ?? {}).reduce((n, list) => n + list.length, 0);
}

export function countMonthlyActuals(
  monthlyActuals: Record<string, Record<MonthKey, number>> | null | undefined
): number {
  return Object.values(monthlyActuals ?? {}).reduce((n, byMonth) => n + Object.keys(byMonth).length, 0);
}
