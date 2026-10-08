// Is any tracker category filed under the wrong `kind`?
//
//   node scripts/audit_kinds.mjs              # every user
//   node scripts/audit_kinds.mjs <user-id>    # one
//
// WHY THIS IS NOT A COSMETIC CHECK. `kind` decides the SIGN of a category
// in net position: an asset's latest snapshot is added, a debt's is
// subtracted. A $4,000 loan filed as an asset moves net position by
// $8,000 in the wrong direction, and it also loses amortization, payoff
// and accrued interest, because `isLoanConfigured` reads `kind` too. The
// forecast is unaffected — a transaction's direction comes from the fixed
// category table, never from `kind` — so this is a net-worth bug, not a
// projection one.
//
// It exists because of a real window: between 2026-10-03 and 2026-10-05,
// `addCategory` had lost a parameter and every category created from the
// Category Manager was written with `kind: 0`. Zero is falsy, so
// `normalize`'s inference caught most of it and defaulted to "asset" —
// which is correct for a savings account and WRONG for a loan whose name
// does not read as one.
//
// THE INDEPENDENT SIGNAL is `originalPrincipal`. Only the loan setup form
// writes it, so a category that carries loan terms and is not typed debt
// is misfiled with certainty rather than suspicion. Name matching is
// reported separately and only as a question.
//
// Read-only. Nothing is written, and nothing is printed that is not
// already in the user's own account.
import { readFileSync, existsSync } from "node:fs";
import { assembleState } from "../src/engine/entities.ts";
import { normalize } from "../src/engine/stateShape.ts";
import { computeNetPosition } from "../src/engine/progress.ts";

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
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const only = process.argv[2] ?? null;

const DEBTISH = /\b(loan|loans|debt|credit|card|visa|mastercard|amex|discover|mortgage|student|auto|car note)\b/i;
const money = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const res = await fetch(
  `${url}/rest/v1/budget_entities?select=user_id,kind,entity_id,data&deleted_at=is.null` +
  (only ? `&user_id=eq.${only}` : ""),
  { headers }
);
if (!res.ok) { console.error(`read failed: ${res.status} ${await res.text()}`); process.exit(1); }
const rows = await res.json();

const byUser = new Map();
for (const r of rows) {
  if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
  byUser.get(r.user_id).push({ kind: r.kind, id: r.entity_id, data: r.data, schemaVersion: 1 });
}

let certain = 0, suspected = 0, invalid = 0;

for (const [userId, entities] of byUser) {
  const state = normalize(assembleState(entities));
  const cats = [...(state.trackerCategories ?? [])].sort((a, b) => a.order - b.order);
  console.log(`\n=== ${userId.slice(0, 8)}…  ${cats.length} categories ===`);

  const latestOf = (id) => {
    const snaps = [...(state.balanceSnapshots?.[id] ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    return snaps.length ? snaps[snaps.length - 1] : null;
  };

  const wrong = [];
  for (const c of cats) {
    const latest = latestOf(c.id);
    const bal = latest ? latest.amount : null;
    const flags = [];

    if (c.kind !== "asset" && c.kind !== "debt") { flags.push(`INVALID kind ${JSON.stringify(c.kind)}`); invalid++; }
    if (c.originalPrincipal != null && c.kind !== "debt") {
      flags.push(`CARRIES LOAN TERMS (original ${money(c.originalPrincipal)}) but is typed ${JSON.stringify(c.kind)}`);
      certain++;
      if (bal != null) wrong.push({ name: c.name, bal });
    } else if (DEBTISH.test(c.name) && c.kind !== "debt") {
      flags.push(`name reads as debt but is typed ${JSON.stringify(c.kind)} — check it`);
      suspected++;
    }

    const tag = flags.length ? "  <-- " + flags.join("; ") : "";
    console.log(
      `  ${String(c.name).padEnd(24)} kind=${String(c.kind).padEnd(7)}` +
      ` balance=${(bal == null ? "none" : money(bal)).padStart(12)}${tag}`
    );
  }

  const net = computeNetPosition(state);
  console.log(`  net position as stored: ${money(net.net)}  (assets ${money(net.assets)}, debt ${money(net.debt)})`);
  if (wrong.length) {
    // Each misfiled loan is counted +balance instead of -balance, so the
    // correction is twice its balance.
    const delta = wrong.reduce((t, w) => t + w.bal * 2, 0);
    console.log(`  IF REFILED AS DEBT:     ${money(net.net - delta)}  — overstated by ${money(delta)}`);
    for (const w of wrong) console.log(`     ${w.name}: ${money(w.bal)} counted as an asset, should be subtracted`);
  }
}

console.log(
  `\n${certain} certainly misfiled (loan terms, not typed debt), ` +
  `${suspected} suspected (name only), ${invalid} with an invalid kind.`
);
process.exit(certain + invalid > 0 ? 1 : 0);
