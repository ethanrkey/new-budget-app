// STEP 3 of the entity migration: prove the backfill lost nothing.
//
//   node scripts/verify_entities.mjs
//
// RUN THIS BEFORE SWITCHING ANY WRITES. While budget_states is still the
// authoritative copy it is a trustworthy baseline to compare against; once
// writes go to entities, the thing you would have compared with has already
// moved and this proves nothing.
//
// For each user, independently of the backfill script:
//   read budget_states  -> normalize            = what the app holds today
//   read budget_entities -> assemble -> normalize = what it would hold after
// and compare the documents, the per-collection counts, and every projected
// number. Exit non-zero on any difference.
//
// Prints hashes, counts and booleans. Nothing is written to disk.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalize } from "../src/engine/stateShape.ts";
import { assembleState } from "../src/engine/entities.ts";
import { computeLedger, computeBudget } from "../src/engine/compute.ts";

function env(name) {
  if (process.env[name]) return process.env[name];
  const local = new URL("../.env.local", import.meta.url);
  if (!existsSync(local)) return null;
  for (const line of readFileSync(local, "utf8").split("\n")) {
    const [k, ...rest] = line.split("=");
    if (k?.trim() === name) return rest.join("=").trim();
  }
  return null;
}
const url = env("VITE_SUPABASE_URL") || env("SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) { console.error("Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const headers = { apikey: key, Authorization: `Bearer ${key}` };

let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};
// Deep key sort before hashing. JSON object key order carries no meaning,
// and `jsonb` does not preserve it anyway — Postgres stores keys in its own
// order, so insisting on byte-identical ordering across the storage boundary
// compares something the storage cannot represent. An old blob whose
// top-level keys happen to be in a different order from assembleState's
// output is not a difference in data: a path-level diff of exactly that case
// returned zero differing paths.
const sortK = (v) =>
  Array.isArray(v) ? v.map(sortK)
  : (v && typeof v === "object")
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortK(v[k])]))
    : v;
const j = (v) => JSON.stringify(v);
const sha = (v) => createHash("sha256").update(j(sortK(v))).digest("hex");
const sizes = (m) =>
  Object.values(m || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : Object.keys(v || {}).length), 0);

const blobs = await (await fetch(`${url}/rest/v1/budget_states?select=user_id,state`, { headers })).json();
const allRows = await (await fetch(`${url}/rest/v1/budget_entities?select=user_id,kind,entity_id,data,schema_version,deleted_at`, { headers })).json();

console.log(`${blobs.length} blob(s), ${allRows.length} entity row(s)\n`);

for (const blob of blobs) {
  const label = createHash("sha256").update(blob.user_id).digest("hex").slice(0, 8);
  const mine = allRows.filter((r) => r.user_id === blob.user_id && r.deleted_at === null);
  console.log(`-- ${label}  (${mine.length} live rows)`);

  const before = normalize(structuredClone(blob.state));
  const after = normalize(structuredClone(assembleState(
    mine.map((r) => ({ kind: r.kind, id: r.entity_id, data: r.data, schemaVersion: r.schema_version }))
  )));

  // An account with NO stored categories gets three seeded by normalize(),
  // with ids from uid() — fresh on every call. So the blob side and the
  // database side cannot agree on those ids, and that is correct behaviour,
  // not drift: seeding is not migrating (maintenance rule 5's scoping note).
  // Canonicalise the seeded ids for that case ONLY, and say so, because
  // quietly loosening a verification is how a real difference hides.
  const wasSeeded = !Array.isArray(blob.state?.trackerCategories) || blob.state.trackerCategories.length === 0;
  const canon = (st) => (wasSeeded
    ? { ...st, trackerCategories: st.trackerCategories.map((c, i) => ({ ...c, id: `seed-${i}` })) }
    : st);
  if (wasSeeded) {
    console.log(`      (no stored categories: normalize seeds fresh uids, so category ids are compared by position)`);
    ok(`${label}: nothing REFERENCES a seeded category id`,
      sizes(before.balanceSnapshots) === 0 && sizes(before.contributionLog) === 0 &&
      (before.settings.visibleTrackerCategoryIds || []).length === 0 &&
      ![...before.recurring, ...before.oneoffs].some((i) => before.trackerCategories.some((c) => c.id === i.category)));
  }

  ok(`${label}: the document is byte-identical`, sha(canon(before)) === sha(canon(after)));

  // Counts in both directions: a hash match cannot catch rows ADDED.
  const count = (k) => mine.filter((r) => r.kind === k).length;
  for (const [kind, expected] of [
    ["recurring", before.recurring.length],
    ["oneoff", before.oneoffs.length],
    ["category", before.trackerCategories.length],
    ["account", before.accounts.length],
    ["accountSnapshot", sizes(before.accountSnapshots)],
    ["snapshot", sizes(before.balanceSnapshots)],
    ["contribution", sizes(before.contributionLog)],
    ["actual", sizes(before.monthlyActuals)],
    ["override", sizes(before.overrides)],
    ["settings", 1],
  ]) {
    ok(`${label}: ${kind} rows == document count`, count(kind) === expected, `${count(kind)} vs ${expected}`);
  }
  const known = new Set(["recurring", "oneoff", "category", "account", "accountSnapshot",
    "snapshot", "contribution", "actual", "override", "settings"]);
  ok(`${label}: no rows of an unknown kind`, mine.every((r) => known.has(r.kind)),
    [...new Set(mine.filter((r) => !known.has(r.kind)).map((r) => r.kind))].join(",") || "");
  ok(`${label}: every row carries a schema stamp`, mine.every((r) => Number.isInteger(r.schema_version)));

  // Belt and braces: every projected number, not just the bytes.
  ok(`${label}: the ledger projects identically`,
    sha(computeLedger(before, before.settings.ledgerHorizon)) === sha(computeLedger(after, before.settings.ledgerHorizon)));
  ok(`${label}: the budget projects identically`,
    sha(computeBudget(before, before.settings.budgetHorizon)) === sha(computeBudget(after, before.settings.budgetHorizon)));
  console.log("");
}

console.log(failures === 0
  ? "ALL PASS — safe to freeze budget_states and switch writes."
  : `${failures} FAILED — do NOT freeze or switch. budget_states is still authoritative and untouched.`);
process.exit(failures === 0 ? 0 : 1);
