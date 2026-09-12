// ---- Pure validation/summary helpers for a full JSON backup restore ----
// Split out of ImportCSV.jsx so this is testable from plain Node (that file
// has JSX, which Node can't parse directly) — same reasoning as
// stateShape.js being split out of storage.js.

// The bare minimum that says "this is plausibly one of our own state
// backups," not just any JSON file someone picked by mistake. Deliberately
// loose beyond that — normalize() (the same function every normal load
// already goes through) fills in everything else and migrates old shapes,
// so a backup from an earlier version of the app restores just as safely
// as loading it normally would.
export function isPlausibleBackup(obj) {
  return !!obj && typeof obj === "object" && Array.isArray(obj.recurring) && Array.isArray(obj.oneoffs);
}

export function countSnapshots(balanceSnapshots) {
  return Object.values(balanceSnapshots || {}).reduce((n, list) => n + list.length, 0);
}

export function countMonthlyActuals(monthlyActuals) {
  return Object.values(monthlyActuals || {}).reduce((n, byMonth) => n + Object.keys(byMonth).length, 0);
}
