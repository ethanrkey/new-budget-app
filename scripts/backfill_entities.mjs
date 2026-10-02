// STEP 2 of the entity migration: budget_states -> budget_entities.
//
//   node scripts/backfill_entities.mjs            # dry run, writes nothing
//   node scripts/backfill_entities.mjs --write
//
// WHY THIS IS JAVASCRIPT AND NOT SQL. The obvious implementation is a jsonb
// unnesting query, and it would be a SECOND, untested implementation of
// splitState sitting beside the tested one — the two could drift and the
// round-trip property would not notice, because it only ever exercises the
// JS. This reuses the exact function the property proves.
//
// Prints hashes, counts and row kinds. No name, amount or date reaches
// stdout, and nothing is written to disk.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalize } from "../src/engine/stateShape.ts";
import { splitState, ENTITY_SCHEMA_VERSION } from "../src/engine/entities.ts";

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
const write = process.argv.includes("--write");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const src = await fetch(`${url}/rest/v1/budget_states?select=user_id,state,updated_at`, { headers });
if (!src.ok) { console.error(`read failed: ${src.status}`); process.exit(1); }
const rows = await src.json();

console.log(`${rows.length} row(s) to backfill. ${write ? "WRITING." : "Dry run — nothing will be written."}\n`);

let total = 0;
for (const row of rows) {
  const label = createHash("sha256").update(row.user_id).digest("hex").slice(0, 8);
  // normalize() first, exactly as a load does. The stored blob may be in an
  // older era; what gets split is what the app would actually hold.
  const entities = splitState(normalize(structuredClone(row.state)));
  const payload = entities.map((e) => ({
    user_id: row.user_id,
    kind: e.kind,
    entity_id: e.id,
    data: e.data,
    schema_version: e.schemaVersion ?? ENTITY_SCHEMA_VERSION,
  }));

  const byKind = {};
  for (const e of entities) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  console.log(`  ${label}  ${payload.length} rows  ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  total += payload.length;

  if (!write) continue;

  // on_conflict on the primary key makes a re-run idempotent: the same
  // backfill twice lands the same rows rather than erroring half way.
  const res = await fetch(`${url}/rest/v1/budget_entities?on_conflict=user_id,kind,entity_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`\n  WRITE FAILED for ${label}: ${res.status} ${await res.text()}`);
    console.error("  Nothing downstream should run. budget_states is untouched.");
    process.exit(1);
  }
  console.log(`            written`);
}

console.log(`\n${total} entity rows ${write ? "written" : "would be written"}.`);
console.log(write
  ? "Next: node scripts/verify_entities.mjs — BEFORE switching any writes."
  : "Re-run with --write when ready.");
