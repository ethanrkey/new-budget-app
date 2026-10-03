// Which migration era is each stored blob in? Shape only.
//
//   node scripts/probe_shapes.mjs
//
// WHY THIS EXISTS. Before exporting anyone's blob, ask whether there is
// anything to learn from it. The entity round-trip is proved over fixtures
// and over one real blob; the only coverage neither of those can give is a
// blob frozen in an OLDER migration era — a user who onboarded once and
// barely opened the app since, whose row still carries a shape every active
// user migrated past months ago. Nobody can guess what that looks like, so
// it has to be asked.
//
// WHAT IT PRINTS. Key names, counts, and booleans. No name, amount, date,
// category, id or email of anyone's financial data reaches stdout, and
// NOTHING IS WRITTEN TO DISK — unlike export_blobs.mjs, this holds each blob
// in memory for the length of one check and forgets it. That is the point:
// it answers the question that would otherwise justify an export.
//
// It also reports the round-trip verdict per row, because that is free here
// and is the actual question an export would be for. A `migrations: none` +
// `roundTrip: ok` row has nothing left to teach us and should not be
// exported.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalize } from "../src/engine/stateShape.ts";
import { splitState, assembleState } from "../src/engine/entities.ts";

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
if (!url || !key) {
  console.error("Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).");
  process.exit(1);
}

const res = await fetch(`${url}/rest/v1/budget_states?select=user_id,state,updated_at`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error(`read failed: ${res.status}`);
  process.exit(1);
}
const rows = await res.json();

// Which migration in PROJECT_SPEC §6 a raw blob would still trigger. Each
// test looks at SHAPE — a key's presence, a type, a length — never a value.
const anyItem = (s, f) => [...(s.recurring || []), ...(s.oneoffs || [])].some(f);
const emptyContainers = (s) =>
  ["accountSnapshots", "balanceSnapshots", "contributionLog", "monthlyActuals", "overrides"]
    .flatMap((k) => Object.values(s[k] || {}))
    .some((v) => (Array.isArray(v) ? v.length : Object.keys(v || {}).length) === 0);

// Era markers (1-7) say a blob was WRITTEN before a shape change and never
// re-saved since — that is the coverage an export could add. 8-10 are not
// era markers: they drop or add a field on read and apply to every row
// until its next save, so they say nothing about how old a blob is.
const ERA_MARKERS = 7;

const MIGRATIONS = [
  ["1 tracker→category", (s) => anyItem(s, (i) => "tracker" in i || i.category === "savings")],
  ["2 hasSeenOnboarding", (s) => s.settings && !("hasSeenOnboarding" in s.settings)],
  ["3 trackerCategories", (s) => !Array.isArray(s.trackerCategories)],
  ["4 category kind", (s) => (s.trackerCategories || []).some((c) => !("kind" in c))],
  ["5 accounts", (s) => !Array.isArray(s.accounts) || s.accounts.length === 0],
  ["6 contributionLog", (s) => !s.contributionLog],
  ["7 loan terms on item", (s) => anyItem(s, (i) => "originalPrincipal" in i || "interestRate" in i)],
  ["8 paidOverrides", (s) => "paidOverrides" in s],
  ["9 overrides", (s) => !s.overrides],
  ["10 empty containers", emptyContainers],
];

const sizes = (m) =>
  Object.values(m || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : Object.keys(v || {}).length), 0);

console.log(`${rows.length} row(s). Shape only — no names, amounts or dates.\n`);
let needExport = 0;

for (const row of rows) {
  const s = row.state || {};
  const label = createHash("sha256").update(row.user_id).digest("hex").slice(0, 8);
  const pending = MIGRATIONS.filter(([, test]) => { try { return test(s); } catch { return true; } }).map(([n]) => n);

  // The round-trip, in memory, nothing persisted. Plus key uniqueness,
  // which the round trip CANNOT catch: duplicate keys survive happily in an
  // in-memory array, so assemble puts both back and the identity holds —
  // only a database primary key rejects them. A real backfill failed on
  // exactly that (Postgres 21000) after the round trip said fine.
  let verdict, keys;
  try {
    const before = normalize(structuredClone(s));
    const rows = splitState(before);
    const after = normalize(structuredClone(assembleState(rows)));
    verdict = JSON.stringify(before) === JSON.stringify(after) ? "ok" : "MISMATCH";
    const seen = new Set(rows.map((e) => `${e.kind}:${e.id}`));
    keys = seen.size === rows.length ? "unique" : `COLLISION (${rows.length - seen.size})`;
  } catch (err) {
    verdict = `THREW (${err.constructor.name})`;
    keys = "n/a";
  }

  console.log(`  ${label}`);
  console.log(`    top-level keys : ${Object.keys(s).sort().join(", ") || "(none)"}`);
  console.log(`    counts         : recurring=${s.recurring?.length ?? 0} oneoffs=${s.oneoffs?.length ?? 0} ` +
    `categories=${s.trackerCategories?.length ?? 0} accounts=${s.accounts?.length ?? 0} ` +
    `acctSnaps=${sizes(s.accountSnapshots)} snaps=${sizes(s.balanceSnapshots)} ` +
    `contribs=${sizes(s.contributionLog)} actuals=${sizes(s.monthlyActuals)} overrides=${sizes(s.overrides)}`);
  const era = pending.filter((n) => Number(n.split(" ")[0]) <= ERA_MARKERS);
  console.log(`    applies on load: ${pending.length ? pending.join(", ") : "nothing"}`);
  console.log(`    written in era : ${era.length ? `pre-${era.map((n) => n.split(" ")[0]).join("/")}` : "current"}`);
  console.log(`    round-trip     : ${verdict}`);
  console.log(`    entity keys    : ${keys}`);
  console.log("");
  // Worth exporting only if the property FAILS on it — an old-era blob that
  // round-trips has already told us everything an export would.
  if (verdict !== "ok" || keys !== "unique") needExport++;
}

console.log(
  needExport === 0
    ? "Every row round-trips. An export would add nothing — skip it."
    : `${needExport} row(s) fail the property and are worth exporting. Tell those users first.`
);
