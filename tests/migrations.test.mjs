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
import {
  splitState, assembleState, diffEntities, tombstoneAlarm,
  anchorMatchesNewestSnapshot, ENTITY_SCHEMA_VERSION,
} from "../src/engine/entities.ts";
import { planWrite, applyResult, keyOf } from "../src/engine/entityStore.ts";
import {
  upsertItem, deleteItem, addCategory, deleteCategory, addBalanceSnapshot,
  addContribution, setMonthlyActual, setOverride, clearOverride, updateAccountBalance,
} from "../src/engine/mutate.ts";
import { primaryAccount, uid } from "../src/engine/model.ts";

// Two sources of nondeterminism have to be pinned or the golden file rots on
// its own, which would train everyone to regenerate it without reading it —
// the exact failure mode the snapshot exists to prevent.
//
// 1. THE CLOCK. blankState() derives budgetHorizon/ledgerHorizon from
//    todayISO(), and a state with no checkInDate gets an account dated today.
//    Left alone the snapshot silently expires overnight. Frozen here; only
//    `new Date()` with no arguments is affected, so every date string in the
//    fixtures still parses normally.
const FROZEN_TODAY = "2026-09-25T12:00:00";
const RealDate = Date;
const frozenMs = new RealDate(FROZEN_TODAY).getTime();
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(frozenMs);
    else super(...args);
  }
  static now() { return frozenMs; }
};

// 2. uid() is Math.random-based, so a freshly seeded account gets different
//    category ids every run. Seeding the RNG makes the golden file stable and
//    makes two runs byte-comparable. Nothing in the engine depends on the
//    sequence — this only pins the ids so a diff means a real change.
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
    monthlyActuals: { q: { "2026-09": 8 } },
    overrides: { q: { "2026-09-09": 14 } } } },

  // 10. per-owner containers left holding nothing. Deleting the last entry
  //     under an owner used to leave the owner behind, riding along in every
  //     save forever. Found by the entity round-trip over a REAL blob — not
  //     one of the nine fixtures above contained an empty container, which is
  //     exactly why they missed it.
  emptyContainers: { data: true, state: {
    settings: { checkInBalance: 500, checkInDate: "2026-09-01" },
    recurring: [{ id: "e1", name: "Electric", amount: 112, category: "bill", cadence: "monthly", startDate: "2026-09-05", order: 0 }],
    oneoffs: [],
    trackerCategories: [{ id: "k", name: "Roth", color: 5, order: 0, kind: "asset" }],
    balanceSnapshots: { k: [{ id: "s", date: "2026-09-01", amount: 100 }], gone: [] },
    contributionLog: { k: [] },
    monthlyActuals: { e1: { "2026-09": 120 }, e2: {} },
    overrides: { e1: {}, nope: {} } } },

  // 11. two balance readings for ONE date. Written before
  //     upsertSnapshotByDate existed, so no mutator ever saw them. Found by
  //     the entity backfill, not by the round-trip property: duplicate keys
  //     survive fine in an array, and only a database primary key rejects
  //     them.
  duplicateDates: { data: true, state: {
    settings: { checkInBalance: 500, checkInDate: "2026-09-01" },
    // The anchor agrees with the newest snapshot on purpose: this fixture
    // is about duplicate DATES, and an inconsistent anchor would make it
    // fail the derived-anchor property too and test two things at once.
    accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 536, balanceAsOf: "2026-10-01", order: 0 }],
    recurring: [], oneoffs: [],
    trackerCategories: [{ id: "k", name: "Roth", color: 5, order: 0, kind: "asset" }],
    accountSnapshots: { checking: [
      { id: "a1", date: "2026-09-28", amount: 444.49 },
      { id: "a2", date: "2026-09-28", amount: 452.10 },
      { id: "a3", date: "2026-10-01", amount: 536 },
    ] },
    balanceSnapshots: { k: [
      { id: "s1", date: "2026-08-01", amount: 9100 },
      { id: "s2", date: "2026-08-01", amount: 9150 },
    ] } } },

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

// ---- The entity split: the safety property for the storage migration -----
// The document is moving to one row per entity. splitState/assembleState are
// that change's whole testable surface, and this is the proof it is lossless:
//
//   assembleState(splitState(s)) deep-equals s
//
// Asserted over every golden fixture, so every migration path is covered by
// construction. Before any live data is touched, the same property is run
// over real exported blobs — fixtures prove the shapes we thought of.
console.log("\n== entity split: round-trip identity ==");
for (const [name, { state }] of Object.entries(FIXTURES)) {
  reseed();
  const normalized = normalize(structuredClone(state));
  const entities = splitState(normalized);
  const rebuilt = assembleState(entities);

  // normalize() on the way back out is what the real load path does, and it
  // is what makes the comparison meaningful: assembleState produces the RAW
  // document shape, not the normalized one.
  ok(`${name}: round-trips through entities unchanged`,
    j(normalize(structuredClone(rebuilt))) === j(normalized));

  ok(`${name}: every row carries the schema stamp`,
    entities.every((e) => e.schemaVersion === ENTITY_SCHEMA_VERSION));
  ok(`${name}: no two rows share a key`,
    new Set(entities.map((e) => `${e.kind}:${e.id}`)).size === entities.length);

  // The anchor is derived from the newest snapshot, so a state whose stored
  // balance disagrees with it will NOT round-trip — by design. Checked here
  // so a disagreement is found before a migration, not after.
  ok(`${name}: stored anchor already agrees with its newest snapshot`,
    anchorMatchesNewestSnapshot(normalized));

  // Nothing is lost on the way down either: every collection's count is
  // reproduced in the rows. A hash match alone cannot catch rows ADDED.
  const count = (k) => entities.filter((e) => e.kind === k).length;
  const sizes = (m) => Object.values(m || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : Object.keys(v).length), 0);
  ok(`${name}: row counts match the document's own counts`,
    count("recurring") === normalized.recurring.length &&
    count("oneoff") === normalized.oneoffs.length &&
    count("category") === normalized.trackerCategories.length &&
    count("account") === normalized.accounts.length &&
    count("accountSnapshot") === sizes(normalized.accountSnapshots) &&
    count("snapshot") === sizes(normalized.balanceSnapshots) &&
    count("contribution") === sizes(normalized.contributionLog) &&
    count("actual") === sizes(normalized.monthlyActuals) &&
    count("override") === sizes(normalized.overrides) &&
    count("settings") === 1);
}

// Migration 10 explicitly: the empty owners go, the populated ones stay.
console.log("\n== migration 10: empty containers are pruned ==");
reseed();
const pruned = normalize(structuredClone(FIXTURES.emptyContainers.state));
ok("an empty snapshot list's owner is dropped", !("gone" in pruned.balanceSnapshots));
ok("...but a populated one stays", pruned.balanceSnapshots.k?.length === 1);
ok("an empty contribution log is dropped", j(pruned.contributionLog) === "{}");
ok("an empty monthlyActuals owner is dropped", !("e2" in pruned.monthlyActuals));
ok("...but a populated one stays", pruned.monthlyActuals.e1?.["2026-09"] === 120);
ok("every empty override owner is dropped", j(pruned.overrides) === "{}");
ok("pruning is idempotent", j(normalize(structuredClone(pruned))) === j(pruned));
ok("a pruned state round-trips through entities",
  j(normalize(structuredClone(assembleState(splitState(pruned))))) === j(pruned));

// Migration 11 explicitly: one reading per date, the later one winning.
console.log("\n== migration 11: same-date snapshots collapse ==");
reseed();
const dd = normalize(structuredClone(FIXTURES.duplicateDates.state));
const acct = dd.accountSnapshots.checking;
ok("three account rows become two", acct.length === 2, j(acct.map((x) => x.date)));
ok("the LATER reading wins, as a correction", acct.find((x) => x.date === "2026-09-28")?.amount === 452.10);
ok("a date with one reading is untouched", acct.find((x) => x.date === "2026-10-01")?.amount === 536);
ok("category snapshots collapse the same way", dd.balanceSnapshots.k.length === 1);
ok("...also keeping the later one", dd.balanceSnapshots.k[0].amount === 9150);
ok("collapsing is idempotent", j(normalize(structuredClone(dd))) === j(dd));

// THE POINT: this is what makes date-keyed entity ids safe. Without it,
// splitState emits two rows with one key and the database rejects the whole
// backfill (Postgres 21000).
const ddRows = splitState(dd);
ok("no two entity rows share a key", new Set(ddRows.map((e) => `${e.kind}:${e.id}`)).size === ddRows.length);
ok("a de-duplicated state round-trips",
  j(normalize(structuredClone(assembleState(ddRows)))) === j(dd));

// ---- Convergence: the WRITE path, not just the shape ----------------------
// The round-trip identity proves splitState/assembleState are lossless for a
// GIVEN state. It says nothing about whether a store updated only by diffs
// still equals the document after a sequence of real edits — a tombstone
// never emitted, an upsert keyed wrong, a rename leaving an orphan row would
// all sail past it, because it never touches a store at all.
//
// This is the coverage the dual-write soak would have given, done better: a
// soak samples whatever one user happened to click over a week, this walks
// hundreds of orderings in milliseconds. The store here is only ever mutated
// by applying a diff, exactly as the database will be.
console.log("\n== entity split: a diff-fed store converges ==");

const applyDiff = (store, diff) => {
  for (const t of diff.tombstones) store.delete(`${t.kind}:${t.id}`);
  for (const e of diff.upserts) store.set(`${e.kind}:${e.id}`, e);
  return store;
};

const MUTATIONS = [
  ["add a recurring rule", (st) => upsertItem(st, { id: uid(), name: "Rule " + uid().slice(0, 3), amount: 50, category: "bill", cadence: "monthly", dayOfMonth: 4, startDate: "2026-09-04", order: st.recurring.length })],
  ["add a one-off", (st) => upsertItem(st, { id: uid(), name: "Once " + uid().slice(0, 3), amount: 25, category: "oneoff", date: "2026-10-09", order: st.oneoffs.length })],
  ["edit an item's amount", (st) => st.recurring[0] ? upsertItem(st, { ...st.recurring[0], amount: st.recurring[0].amount + 7 }) : st],
  ["rename an item", (st) => st.recurring[0] ? upsertItem(st, { ...st.recurring[0], name: st.recurring[0].name + "x" }) : st],
  ["delete an item", (st) => st.recurring[0] ? deleteItem(st, st.recurring[0].id) : st],
  ["add a category", (st) => addCategory(st, "Cat " + uid().slice(0, 3), 2, "asset")],
  ["delete a category", (st) => st.trackerCategories[0] ? deleteCategory(st, st.trackerCategories[0].id) : st],
  ["log a category balance", (st) => st.trackerCategories[0] ? addBalanceSnapshot(st, st.trackerCategories[0].id, 1000, "2026-09-14") : st],
  ["log another on a new date", (st) => st.trackerCategories[0] ? addBalanceSnapshot(st, st.trackerCategories[0].id, 1100, "2026-10-14") : st],
  ["correct a logged balance (same date)", (st) => st.trackerCategories[0] ? addBalanceSnapshot(st, st.trackerCategories[0].id, 1234, "2026-09-14") : st],
  ["log a contribution", (st) => st.trackerCategories[0] ? addContribution(st, st.trackerCategories[0].id, 100, "2026-09-15") : st],
  ["set a monthly actual", (st) => st.recurring[0] ? setMonthlyActual(st, st.recurring[0].id, "2026-09", 88) : st],
  ["override one occurrence", (st) => st.recurring[0] ? setOverride(st, st.recurring[0].id, "2026-10-04", 300) : st],
  ["clear that override", (st) => st.recurring[0] ? clearOverride(st, st.recurring[0].id, "2026-10-04") : st],
  ["update the verified balance", (st) => updateAccountBalance(st, primaryAccount(st).id, 2500 + (st.recurring.length * 13), "2026-10-20")],
];

let converged = true;
let firstBreak = "";
for (const seedRun of [1, 2, 3, 4, 5]) {
  reseed();
  let doc = normalize(structuredClone(FIXTURES.alreadyModern.state));
  const store = new Map(splitState(doc).map((e) => [`${e.kind}:${e.id}`, e]));
  let prev = splitState(doc);

  for (let step = 0; step < 40; step++) {
    const [label, fn] = MUTATIONS[Math.floor(Math.random() * MUTATIONS.length)];
    const next = normalize(structuredClone(fn(doc)));
    const nextRows = splitState(next);
    applyDiff(store, diffEntities(prev, nextRows));

    const fromStore = normalize(structuredClone(assembleState([...store.values()])));
    if (j(fromStore) !== j(next)) {
      converged = false;
      firstBreak = `run ${seedRun}, step ${step}, after "${label}"`;
      break;
    }
    doc = next;
    prev = nextRows;
  }
  if (!converged) break;
}
ok("a store fed only diffs still equals the document after 200 edits", converged, firstBreak);

// The two shapes a diff bug actually takes, pinned directly.
reseed();
const convBase = normalize(structuredClone(FIXTURES.alreadyModern.state));
const convRows = splitState(convBase);
const afterDelete = splitState(normalize(deleteItem(convBase, convBase.recurring[0].id)));
const delStore = applyDiff(new Map(convRows.map((e) => [`${e.kind}:${e.id}`, e])), diffEntities(convRows, afterDelete));
ok("a deleted item leaves no row behind in the store",
  ![...delStore.values()].some((e) => e.kind === "recurring" && e.id === convBase.recurring[0].id));

const renamed = splitState(normalize(upsertItem(convBase, { ...convBase.recurring[0], name: "Renamed" })));
const renStore = applyDiff(new Map(convRows.map((e) => [`${e.kind}:${e.id}`, e])), diffEntities(convRows, renamed));
ok("a rename updates in place and orphans nothing",
  [...renStore.values()].filter((e) => e.kind === "recurring").length === convBase.recurring.length);

// ---- The write PLAN: shared by both clients, so tested once ------------
console.log("\n== write plan: order, guards, and when to stop ==");
reseed();
const planBase = normalize(structuredClone(FIXTURES.alreadyModern.state));
const planRows = splitState(planBase);
const vmap = new Map(planRows.map((e, i) => [keyOf(e), i + 1]));

ok("an unchanged state plans no work", planWrite(planRows, planRows, vmap).ops.length === 0);

// A row we hold a version for is a guarded UPDATE; one we do not is an
// INSERT, because the alternative — forcing — is how a stale device wins.
const edited = splitState({ ...planBase, recurring: planBase.recurring.map((r) => ({ ...r, amount: r.amount + 1 })) });
const p1 = planWrite(planRows, edited, vmap);
ok("a known row is a guarded update", p1.ops.length === 1 && p1.ops[0].op === "update");
ok("...carrying the version we loaded", p1.ops[0].version === vmap.get(keyOf(p1.ops[0].entity)));

const p2 = planWrite(planRows, edited, new Map());
ok("a row we hold no version for is an insert", p2.ops[0].op === "insert");

// THE ORDERING RULE. A conflict part-way must stop before anything is
// REMOVED: losing an edit is recoverable, a tombstone on a stale view is not.
const churn = splitState({
  ...planBase,
  recurring: [],
  oneoffs: [...planBase.oneoffs, { id: "new1", name: "New", amount: 5, category: "oneoff", date: "2026-10-09", order: 9, accountId: "checking" }],
});
const p3 = planWrite(planRows, churn, vmap);
const firstTombstone = p3.ops.findIndex((o) => o.op === "tombstone");
const lastUpsert = p3.ops.map((o) => o.op).lastIndexOf("insert") >= 0
  ? Math.max(p3.ops.map((o) => o.op).lastIndexOf("insert"), p3.ops.map((o) => o.op).lastIndexOf("update"))
  : p3.ops.map((o) => o.op).lastIndexOf("update");
ok("every upsert is planned before any tombstone", firstTombstone === -1 || firstTombstone > lastUpsert,
  p3.ops.map((o) => o.op).join(","));
ok("tombstones carry their version too", p3.ops.filter((o) => o.op === "tombstone").every((o) => o.version !== undefined));

// The alarm rides on the plan, so neither client has to re-derive it.
ok("wiping nearly everything raises the alarm", planWrite(planRows, splitState(normalize({})), vmap).alarm === true);
ok("an ordinary edit does not", p1.alarm === false);

// Bookkeeping must stay identical across clients or every later write
// becomes a spurious conflict.
const vm2 = new Map(vmap);
applyResult(vm2, p1.ops[0], 99);
ok("a successful update records the new version", vm2.get(keyOf(p1.ops[0].entity)) === 99);
const tomb = p3.ops.find((o) => o.op === "tombstone");
applyResult(vm2, tomb, null);
ok("a tombstone forgets the row", !vm2.has(keyOf(tomb.ref)));

console.log("\n== entity split: diff and alarms ==");
reseed();
const diffBase = normalize(structuredClone(FIXTURES.alreadyModern.state));
const baseRows = splitState(diffBase);

ok("an unchanged state sends nothing",
  j(diffEntities(baseRows, splitState(diffBase))) === j({ upserts: [], tombstones: [] }));

// Editing one rule sends ONE row — the entire point of the change.
const editedOne = splitState({ ...diffBase, recurring: diffBase.recurring.map((r) => ({ ...r, amount: r.amount + 1 })) });
const d1 = diffEntities(baseRows, editedOne);
ok("editing one item sends exactly that row", d1.upserts.length === 1 && d1.upserts[0].kind === "recurring", j(d1.tombstones));
ok("...and tombstones nothing", d1.tombstones.length === 0);

// A removal becomes a tombstone, never an absence.
const removed = splitState({ ...diffBase, recurring: [] });
const d2 = diffEntities(baseRows, removed);
ok("a removed item becomes a tombstone", d2.tombstones.length === 1 && d2.tombstones[0].kind === "recurring");
ok("...carrying the id so a stale device cannot outrank it", !!d2.tombstones[0].id);

// An unrelated edit on each of two devices must not collide.
const deviceA = splitState({ ...diffBase, settings: { ...diffBase.settings, theme: "light" } });
const deviceB = splitState({ ...diffBase, trackerCategories: diffBase.trackerCategories.map((c) => ({ ...c, name: c.name + "!" })) });
const keysOf = (dd) => dd.upserts.map((e) => `${e.kind}:${e.id}`);
ok("two devices editing different things touch disjoint rows",
  keysOf(diffEntities(baseRows, deviceA)).every((k) => !keysOf(diffEntities(baseRows, deviceB)).includes(k)));

// The tombstone alarm replaces the old whole-document empty-state check.
ok("wiping nearly everything trips the alarm",
  tombstoneAlarm(baseRows, diffEntities(baseRows, splitState(normalize({})))) === true);
ok("an ordinary single deletion does not", tombstoneAlarm(baseRows, d2) === false);
ok("an empty history cannot trip it", tombstoneAlarm([], { upserts: [], tombstones: [] }) === false);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
