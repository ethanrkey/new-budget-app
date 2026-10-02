// Run the entity round-trip property against REAL exported blobs.
//
//   node scripts/export_blobs.mjs     # once, needs the service_role key
//   node tests/real-blobs.test.mjs
//
// Golden fixtures prove the shapes we thought of. This proves the ones we
// did not, and it is the gate in front of phase 0 of the storage migration:
// no live data moves until every real blob round-trips.
//
// Not part of `npm test` on purpose — it needs .blobs/, which is gitignored
// and only ever exists on a machine that has deliberately exported it. It
// skips cleanly when absent so CI is unaffected.
//
// Prints hashes and counts. Never a name, an amount or a date.
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalize } from "../src/engine/stateShape.ts";
import { splitState, assembleState, anchorMatchesNewestSnapshot, ENTITY_SCHEMA_VERSION } from "../src/engine/entities.ts";
import { computeLedger, computeBudget } from "../src/engine/compute.ts";

const DIR = new URL("../.blobs/", import.meta.url);
if (!existsSync(DIR)) {
  console.log("no .blobs/ — run scripts/export_blobs.mjs first. Skipping.");
  process.exit(0);
}

let failures = 0;
function ok(name, pass, detail = "") {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}
const j = (v) => JSON.stringify(v);
const sha = (v) => createHash("sha256").update(j(v)).digest("hex");

const manifest = JSON.parse(readFileSync(new URL("manifest.json", DIR), "utf8"));
const files = readdirSync(fileURLToPath(DIR)).filter((f) => f.startsWith("blob-"));
console.log(`== entity round-trip over ${files.length} real blob(s) ==\n`);

const sizes = (m) =>
  Object.values(m || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : Object.keys(v || {}).length), 0);

for (const entry of manifest) {
  const raw = JSON.parse(readFileSync(new URL(`blob-${entry.label}.json`, DIR), "utf8"));
  console.log(`-- ${entry.label} (${entry.bytes} bytes)`);

  // The hash the export recorded still describes the file on disk: proves we
  // are checking what was exported, not something edited since.
  ok(`${entry.label}: file matches its exported hash`,
    createHash("sha256").update(JSON.stringify(raw)).digest("hex") === entry.sha256);

  const before = normalize(structuredClone(raw));
  const entities = splitState(before);
  const after = normalize(structuredClone(assembleState(entities)));

  // THE PROPERTY.
  ok(`${entry.label}: round-trips through entities unchanged`, sha(before) === sha(after));

  ok(`${entry.label}: no two rows share a key`,
    new Set(entities.map((e) => `${e.kind}:${e.id}`)).size === entities.length,
    `${entities.length} rows`);
  ok(`${entry.label}: every row carries the schema stamp`,
    entities.every((e) => e.schemaVersion === ENTITY_SCHEMA_VERSION));

  // Counts in both directions — a hash match cannot catch rows ADDED.
  const count = (k) => entities.filter((e) => e.kind === k).length;
  const pairs = [
    ["recurring", before.recurring.length],
    ["oneoff", before.oneoffs.length],
    ["category", before.trackerCategories.length],
    ["account", before.accounts.length],
    ["accountSnapshot", sizes(before.accountSnapshots)],
    ["snapshot", sizes(before.balanceSnapshots)],
    ["contribution", sizes(before.contributionLog)],
    ["actual", sizes(before.monthlyActuals)],
    ["override", sizes(before.overrides)],
  ];
  for (const [kind, expected] of pairs) {
    ok(`${entry.label}: ${kind} rows == document count`, count(kind) === expected, `${count(kind)} vs ${expected}`);
  }

  // Date-keyed snapshots are the one place a real blob can legitimately
  // carry something the new model forbids: two readings for one date. Say
  // so precisely rather than letting the round-trip fail opaquely.
  const dupes = [];
  for (const [owner, list] of Object.entries({ ...before.accountSnapshots, ...before.balanceSnapshots })) {
    const seen = new Set();
    for (const s of list || []) {
      if (seen.has(s.date)) dupes.push(`${owner}@${s.date}`);
      seen.add(s.date);
    }
  }
  ok(`${entry.label}: no two snapshots share a date`, dupes.length === 0,
    dupes.length ? `${dupes.length} duplicate date(s) — these collapse on migration` : "");

  // The anchor is derived from the newest snapshot, so a stored balance that
  // disagrees will MOVE. Intended, but it must be seen, not discovered.
  ok(`${entry.label}: stored anchor already agrees with its newest snapshot`,
    anchorMatchesNewestSnapshot(before));

  // Belt and braces: every projected number identical, not just the bytes.
  const horizon = before.settings.ledgerHorizon;
  ok(`${entry.label}: the ledger projects identically`,
    sha(computeLedger(before, horizon)) === sha(computeLedger(after, horizon)));
  ok(`${entry.label}: the budget projects identically`,
    sha(computeBudget(before, before.settings.budgetHorizon)) === sha(computeBudget(after, before.settings.budgetHorizon)));
  console.log("");
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
