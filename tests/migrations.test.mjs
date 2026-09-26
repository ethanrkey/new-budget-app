// Migration regression harness — pure Node, no framework. Run: npm test
//
// stateShape.normalize() is the riskiest code in the repo: every load of real
// financial history passes through it, and a migration that quietly changes
// its output has no other alarm. This file is that alarm.
//
// Two layers:
//   1. INVARIANTS — idempotency everywhere, determinism wherever it is a real
//      guarantee (see the scoping note below and maintenance rule 5).
//   2. A GOLDEN SNAPSHOT of normalize()'s output for every migration path. Any
//      change to any migration shows up here as a diff that has to be looked
//      at and accepted deliberately:  node tests/migrations.test.mjs --update
//
// Adding a migration means adding a fixture here in the same commit.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { normalize } from "../src/engine/stateShape.ts";

// uid() is Math.random-based, so a freshly seeded account gets different
// category ids every run. Seeding the RNG makes the golden file stable and
// makes two runs byte-comparable. Nothing in the engine depends on the
// sequence — this only pins the ids so a diff means a real change.
let _seed = 123456789;
Math.random = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const reseed = () => { _seed = 123456789; };

let failures = 0;
function ok(name, pass, detail = "") {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}
const j = (v) => JSON.stringify(v);

// ---- The fixtures: one per migration path in stateShape.js ----------------
// `data: false` marks a state with no items. Those seed a brand-new account
// rather than migrating anything, so they are idempotent but NOT deterministic
// across processes — that is correct behavior, not a bug. See rule 5.
const FIXTURES = {
  // 1. very old data: a separate `tracker` field and the preset "savings"
  legacyTrackerField: { data: true, state: {
    settings: { checkInBalance: 1000, checkInDate: "2026-01-01" },
    recurring: [{ id: "a", name: "Roth", amount: 100, category: "savings", tracker: "roth", cadence: "monthly", startDate: "2026-01-05", order: 0 }],
    oneoffs: [{ id: "b", name: "Gift", amount: 50, category: "savings", date: "2026-02-01", order: 1 }] } },

  // 2. hasSeenOnboarding absent + real data -> treated as already seen
  onboardingBackfill: { data: true, state: {
    settings: { checkInBalance: 500, checkInDate: "2026-03-01" },
    recurring: [{ id: "r", name: "Rent", amount: 1500, category: "bill", cadence: "monthly", startDate: "2026-03-02", order: 0 }], oneoffs: [] } },

  // 3. trackerCategories absent + data -> the legacy four, same ids
  legacyFourCategories: { data: true, state: {
    settings: { checkInBalance: 200, checkInDate: "2026-04-01" },
    recurring: [{ id: "x", name: "Loan", amount: 300, category: "loans", cadence: "monthly", startDate: "2026-04-15", order: 0 }], oneoffs: [] } },

  // 4. `kind` inference over an existing custom list
  kindInference: { data: true, state: {
    settings: { checkInBalance: 0, checkInDate: "2026-05-01" },
    recurring: [{ id: "y", name: "Car", amount: 200, category: "c1", cadence: "monthly", startDate: "2026-05-10", order: 0 }], oneoffs: [],
    trackerCategories: [{ id: "c1", name: "Car Debt", color: 1, order: 0 }, { id: "c2", name: "Vacation", color: 2, order: 1 }, { id: "loans", name: "Loans", color: 3, order: 2 }] } },

  // 5. accounts built from legacy settings; items stamped; history seeded
  accountsMigration: { data: true, state: {
    settings: { checkInBalance: 4321.98, checkInDate: "2026-06-01", budgetHorizon: "2026-12-01", ledgerHorizon: "2026-12-01" },
    recurring: [{ id: "m", name: "Rent", amount: 1000, category: "bill", cadence: "monthly", startDate: "2026-06-02", order: 0 }],
    oneoffs: [{ id: "n", name: "Trip", amount: 400, category: "oneoff", date: "2026-07-04", order: 1 }] } },

  // 6. loan terms on a payment item -> moved onto its debt category
  loanItemMigration: { data: true, state: {
    settings: { checkInBalance: 100, checkInDate: "2026-08-01" },
    recurring: [{ id: "L1", name: "Student Loans", amount: 220, category: "loans", cadence: "monthly", dayOfMonth: 15, startDate: "2026-01-15", order: 0, originalPrincipal: 18000, interestRate: 5.8, interestStartDate: "2026-12-01" }],
    oneoffs: [], trackerCategories: [{ id: "loans", name: "Student Loans", color: 3, order: 0, kind: "debt" }] } },

  // 6b. a SECOND configured loan in one category spawns its own
  twoLoansOneCategory: { data: true, state: {
    settings: { checkInBalance: 100, checkInDate: "2026-08-01" },
    recurring: [
      { id: "L1", name: "Loan A", amount: 220, category: "loans", cadence: "monthly", dayOfMonth: 15, startDate: "2026-01-15", order: 0, originalPrincipal: 18000, interestRate: 5.8 },
      { id: "L2", name: "Loan B", amount: 90, category: "loans", cadence: "monthly", dayOfMonth: 20, startDate: "2026-02-20", order: 1, originalPrincipal: 2000, interestRate: 6.5 },
    ], oneoffs: [], trackerCategories: [{ id: "loans", name: "Loans", color: 3, order: 0, kind: "debt" }] } },

  // 7. tabOrder stale/duplicated; contributionLog absent
  tabOrderRepair: { data: false, state: {
    settings: { checkInBalance: 10, checkInDate: "2026-09-01", tabOrder: ["spending", "gone", "spending"] },
    recurring: [], oneoffs: [] } },

  // an already-modern state must survive untouched
  alreadyModern: { data: true, state: {
    settings: { budgetHorizon: "2027-01-01", ledgerHorizon: "2027-01-01", theme: "dark", visibleTrackerCategoryIds: ["k"], tabOrder: ["ledger", "budget", "dashboard", "spending"], hasSeenOnboarding: true },
    accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 7, balanceAsOf: "2026-09-08", order: 0 }],
    recurring: [{ id: "q", name: "Sub", amount: 9, category: "bill", cadence: "monthly", startDate: "2026-09-09", order: 0, accountId: "checking" }],
    oneoffs: [], paidOverrides: { "2026-09": ["q"] },
    trackerCategories: [{ id: "k", name: "Roth", color: 5, order: 0, kind: "asset" }],
    balanceSnapshots: { k: [{ id: "s", date: "2026-09-01", amount: 100 }] },
    contributionLog: { k: [{ id: "c", date: "2026-09-02", amount: 50, source: "manual" }] },
    accountSnapshots: { checking: [{ id: "a", date: "2026-09-08", amount: 7 }] },
    monthlyActuals: { q: { "2026-09": 8 } } } },

  // the empty case: seeds a new account, migrates nothing
  empty: { data: false, state: {} },
};

// ---- Run ------------------------------------------------------------------
const GOLDEN = new URL("./migrations.golden.json", import.meta.url);
const updating = process.argv.includes("--update");
const results = {};

console.log("== normalize(): invariants ==");
for (const [name, { data, state }] of Object.entries(FIXTURES)) {
  reseed();
  const once = normalize(structuredClone(state));
  const twice = normalize(structuredClone(once));
  reseed();
  const independent = normalize(structuredClone(state));

  ok(`${name}: idempotent (normalize twice == once)`, j(once) === j(twice));
  if (data) {
    ok(`${name}: deterministic across runs`, j(once) === j(independent));
  } else {
    // Not a failure: seeding a brand-new account mints fresh category ids.
    // Assert the SHAPE is stable even though the ids are not, so a real
    // regression here still gets caught.
    const shape = (s) => j({ ...s, trackerCategories: s.trackerCategories.map((c) => ({ ...c, id: "<seeded>" })) });
    ok(`${name}: no items -> ids are seeded, shape still stable`, shape(once) === shape(independent));
  }
  results[name] = once;
}

console.log("\n== normalize(): golden snapshot ==");
if (updating) {
  writeFileSync(GOLDEN, JSON.stringify(results, null, 1) + "\n");
  console.log("golden snapshot REWRITTEN — review the diff before committing");
} else if (!existsSync(GOLDEN)) {
  ok("golden snapshot exists", false, "run with --update to create it");
} else {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
  for (const name of Object.keys(FIXTURES)) {
    ok(`${name}: output matches the golden snapshot`, j(results[name]) === j(golden[name]));
  }
  const extra = Object.keys(golden).filter((k) => !(k in FIXTURES));
  ok("no stale fixtures left in the golden file", extra.length === 0, extra.join(",") || "");
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
