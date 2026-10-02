// Export every user's state blob for pre-migration verification.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/export_blobs.mjs
//
// (or put SUPABASE_SERVICE_ROLE_KEY in .env.local, which is gitignored, and
// this reads it from there — the key never has to be typed into a shell.)
//
// WHY THIS EXISTS. The entity migration is proved by a round-trip identity
// over golden fixtures, which proves the shapes we thought of. Real blobs
// prove the ones we did not. This writes them to .blobs/ (gitignored, same
// rule as *.csv: real financial data never enters the repo) along with a
// manifest of SHA-256 and a per-collection count vector.
//
// It prints hashes, counts and nothing else. No amount, name, date or id of
// anyone's financial data reaches stdout, because the output of this script
// is the thing most likely to get pasted somewhere.
//
// The service_role key bypasses RLS by design — that is the only way to read
// four users' rows. Rotate it afterwards if you like; nothing here stores it.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const OUT = new URL("../.blobs/", import.meta.url);

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
  console.error(
    "Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
    "Add SUPABASE_SERVICE_ROLE_KEY to .env.local (gitignored) and re-run."
  );
  process.exit(1);
}

const res = await fetch(`${url}/rest/v1/budget_states?select=user_id,state,updated_at`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error(`read failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();

// The count vector. A hash proves nothing was ALTERED; counts prove nothing
// was added or dropped. Both, or the check is one-directional.
const sizes = (m) =>
  Object.values(m || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : Object.keys(v || {}).length), 0);
const counts = (s) => ({
  recurring: s.recurring?.length ?? 0,
  oneoffs: s.oneoffs?.length ?? 0,
  trackerCategories: s.trackerCategories?.length ?? 0,
  accounts: s.accounts?.length ?? 0,
  accountSnapshots: sizes(s.accountSnapshots),
  balanceSnapshots: sizes(s.balanceSnapshots),
  contributionLog: sizes(s.contributionLog),
  monthlyActuals: sizes(s.monthlyActuals),
  overrides: sizes(s.overrides),
});

mkdirSync(OUT, { recursive: true });
const manifest = [];
for (const row of rows) {
  // A short, stable, non-reversible label. The user_id itself is an account
  // identifier and does not need to be in a filename or on a terminal.
  const label = createHash("sha256").update(row.user_id).digest("hex").slice(0, 8);
  const json = JSON.stringify(row.state);
  const sha = createHash("sha256").update(json).digest("hex");
  writeFileSync(new URL(`blob-${label}.json`, OUT), json);
  manifest.push({ label, sha256: sha, bytes: json.length, updated_at: row.updated_at, counts: counts(row.state) });
}
writeFileSync(new URL("manifest.json", OUT), JSON.stringify(manifest, null, 1) + "\n");

console.log(`exported ${manifest.length} blob(s) to .blobs/ (gitignored)\n`);
for (const m of manifest) {
  console.log(`  ${m.label}  ${m.sha256.slice(0, 16)}…  ${String(m.bytes).padStart(7)} bytes`);
  console.log(`            ${Object.entries(m.counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}
