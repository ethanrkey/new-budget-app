// Apply a user's own answers to `assetKind`, by name.
//
//   node scripts/set_asset_kinds.mjs            # dry run
//   node scripts/set_asset_kinds.mjs --write
//
// DELIBERATELY NOT A MIGRATION. normalize() adds the field absent and
// infers nothing, because "is this market-exposed" is unknowable from
// stored data and maintenance rule 5 forbids a migration inventing values.
// A user stating their own answers is data entry; this is the keyboard.
// Edit ANSWERS below for whoever is being set up.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const ANSWERS = {
  // Stated 2026-10-03. HSA is an investment despite being untouched:
  // it is entirely in one stock, and not interacting with an account is
  // not the same as not being exposed by it.
  "Savings": "savings",
  "Roth IRA": "investment",
  "401k": "investment",
  "Brokerage": "investment",
  "HSA": "investment",
};
const EMAIL = process.argv.includes("--email")
  ? process.argv[process.argv.indexOf("--email") + 1]
  : "ethankey@bu.edu";

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
const url = env("VITE_SUPABASE_URL"), key = env("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) { console.error("Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const write = process.argv.includes("--write");

const users = (await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers })).json()).users;
const user = users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
if (!user) { console.error("no account for that address"); process.exit(1); }
const label = createHash("sha256").update(user.id).digest("hex").slice(0, 8);

const rows = await (await fetch(
  `${url}/rest/v1/budget_entities?select=entity_id,data,version&user_id=eq.${user.id}&kind=eq.category&deleted_at=is.null`,
  { headers })).json();

console.log(`${label}: ${rows.length} categories. ${write ? "WRITING." : "Dry run."}\n`);
let missed = Object.keys(ANSWERS);
for (const row of rows) {
  const want = ANSWERS[row.data.name];
  if (row.data.kind !== "asset") { console.log(`  skip   ${row.data.name} (${row.data.kind})`); continue; }
  missed = missed.filter((n) => n !== row.data.name);
  if (!want) { console.log(`  UNSET  ${row.data.name} — no answer given, stays unanswered`); continue; }
  if (row.data.assetKind === want) { console.log(`  ok     ${row.data.name} already ${want}`); continue; }
  console.log(`  set    ${row.data.name} -> ${want}`);
  if (!write) continue;
  const res = await fetch(`${url}/rest/v1/budget_entities?user_id=eq.${user.id}&kind=eq.category&entity_id=eq.${row.entity_id}`, {
    method: "PATCH", headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ data: { ...row.data, assetKind: want } }),
  });
  if (!res.ok) { console.error(`  FAILED ${row.data.name}: ${res.status} ${await res.text()}`); process.exit(1); }
}
if (missed.length) console.log(`\n  no category matched: ${missed.join(", ")}`);
console.log(write ? "\ndone" : "\nRe-run with --write.");
