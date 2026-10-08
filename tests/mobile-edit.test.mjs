// The phone's transaction wiring: what a tapped row MEANS.
//
//   node tests/mobile-edit.test.mjs     (runs in `npm test`, so in CI)
//
// The web's occurrence-date bug shipped because the form was verified
// standalone and the wiring between it and the mutators never was —
// `baseId()` stripped the date in a place that needed it, so a one-month
// edit rewrote every month. That bug lived in exactly the layer this file
// covers: row id -> scope -> mutation -> committed state.
//
// So `mobile/lib/edit.ts` holds no React, and every assertion below goes
// all the way to the state a commit would persist, never to an
// intermediate object. "The handler built the right payload" is the claim
// that was true when that bug shipped.
import {
  itemIdOf, dateOf, rowTarget, scopeActions, overrideAt, orphansIfSaved,
  saveItem, saveOccurrence, resetOccurrence, removeItem,
  blankDraft, draftOf, draftError, overrideError, itemFrom, canTrackActuals,
} from "../mobile/lib/edit.ts";
import { normalize } from "../src/engine/stateShape.ts";
import { computeLedger } from "../src/engine/compute.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, cond) => eq(label, !!cond, true);

// A real state: one rule with an override on a specific date, one one-off,
// a debt category and a savings category.
const base = normalize({
  settings: { budgetHorizon: "2027-04-01", ledgerHorizon: "2027-02-01" },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: "2026-10-01", order: 0 }],
  trackerCategories: [
    { id: "c-save", name: "Savings", kind: "asset", assetKind: "savings", order: 0 },
    { id: "c-loan", name: "Car loan", kind: "debt", order: 1, originalPrincipal: 14200 },
  ],
  recurring: [
    { id: "r-rent", name: "Rent", amount: 1450, category: "bill", order: 0,
      cadence: "monthly", startDate: "2026-04-01", dayOfMonth: 1 },
    { id: "r-pay", name: "Paycheck", amount: 1840, category: "income", order: 1,
      cadence: "biweekly", startDate: "2026-10-02" },
  ],
  oneoffs: [{ id: "o-dent", name: "Dentist", amount: 180, category: "oneoff", order: 2, date: "2026-10-14" }],
  overrides: { "r-rent": { "2026-12-01": 1600 } },
});

// ---------- 1. The row id, which is where the web bug was ----------
console.log("\n== a ledger row id carries its date ==");
eq("itemIdOf drops the date", itemIdOf("r-rent@2026-12-01"), "r-rent");
eq("dateOf keeps it", dateOf("r-rent@2026-12-01"), "2026-12-01");
eq("a row with no date half yields null, not undefined-as-a-date", dateOf("r-rent"), null);

// The ids the engine actually produces, not ones invented for the test.
const ledger = computeLedger(base, "2027-02-01");
const rentRow = ledger.rows.find((r) => r.name === "Rent" && r.date === "2026-12-01");
is("the engine really does emit <id>@<date>", rentRow.id === "r-rent@2026-12-01");
eq("...and the overridden date is marked as such", rentRow.overridden, true);
eq("...carrying the override's amount, not the rule's", rentRow.amount, 1600);

// ---------- 1b. The row the sheet names IS the row it acts on ----------
// A sheet headed "Delete Paycheck" that deletes something else is the
// worst bug this screen could have, and it is what two separate lookups —
// one in the view for the label, one in the handler for the mutation —
// eventually produce. There is one lookup, and this is it.
console.log("\n== one resolution per tapped row ==");
for (const [rowId, name, recurring] of [
  ["r-rent@2026-12-01", "Rent", true],
  ["r-pay@2026-10-02", "Paycheck", true],
  ["o-dent@2026-10-14", "Dentist", false],
]) {
  const t = rowTarget(base, rowId);
  eq(`${rowId} resolves to ${name}`, [t.name, t.recurring, t.item.id], [name, recurring, itemIdOf(rowId)]);
  eq(`...and the mutation hits that same id`,
    removeItem(t.item.id)(base).recurring.concat(removeItem(t.item.id)(base).oneoffs).some((i) => i.id === t.item.id),
    false);
}
eq("every row the engine emits resolves to something",
  ledger.rows.filter((r) => rowTarget(base, r.id) === null).map((r) => r.id), []);
eq("...and always to the item whose name the row shows",
  ledger.rows.every((r) => rowTarget(base, r.id).name === r.name), true);
eq("a row id for an item that no longer exists resolves to null, not a wrong item",
  rowTarget(base, "r-gone@2026-11-01"), null);

// ---------- 2. What the scope sheet offers ----------
console.log("\n== the scope sheet ==");
eq("a recurring row with no override: edit this date, edit the rule, delete the rule",
  scopeActions(base, "r-rent@2026-11-01", true).map((a) => a.kind),
  ["edit-occurrence", "edit-rule", "delete-rule"]);
eq("...and 'this date' comes FIRST — the recoverable mistake is the default",
  scopeActions(base, "r-rent@2026-11-01", true)[0].kind, "edit-occurrence");
eq("a date that already has its own amount also offers a reset",
  scopeActions(base, "r-rent@2026-12-01", true).map((a) => a.kind),
  ["edit-occurrence", "edit-rule", "reset-occurrence", "delete-rule"]);
eq("...and the reset names the date it would clear",
  scopeActions(base, "r-rent@2026-12-01", true).find((a) => a.kind === "reset-occurrence").date,
  "2026-12-01");
eq("a ONE-OFF has no occurrence scope — it is already one occurrence",
  scopeActions(base, "o-dent@2026-10-14", false).map((a) => a.kind), ["edit-rule", "delete-rule"]);
is("delete is always offered, so the sheet answers the delete ambiguity too",
  scopeActions(base, "r-rent@2026-11-01", true).some((a) => a.kind === "delete-rule"));
is("there is deliberately NO delete-occurrence — the engine has no skip",
  !scopeActions(base, "r-rent@2026-12-01", true).some((a) => a.kind === "delete-occurrence"));

// ---------- 3. Editing one date does not touch the rule ----------
console.log("\n== occurrence scope changes exactly one date ==");
const afterOcc = saveOccurrence("r-rent", "2026-11-01", "1500")(base);
eq("the override lands on the date that was tapped", overrideAt(afterOcc, "r-rent", "2026-11-01"), 1500);
eq("THE RULE IS UNTOUCHED — this is the bug that shipped on the web",
  afterOcc.recurring.find((r) => r.id === "r-rent").amount, 1450);
eq("every other date keeps the rule's amount",
  computeLedger(afterOcc, "2027-02-01").rows.filter((r) => r.name === "Rent").map((r) => [r.date, r.amount]),
  [["2026-10-01", 1450], ["2026-11-01", 1500], ["2026-12-01", 1600], ["2027-01-01", 1450], ["2027-02-01", 1450]]);
eq("a negative is stored as an outflow magnitude, like every other amount",
  overrideAt(saveOccurrence("r-rent", "2026-11-01", "-99")(base), "r-rent", "2026-11-01"), 99);
eq("resetting drops that date and leaves the others",
  Object.keys(resetOccurrence("r-rent", "2026-12-01")(base).overrides["r-rent"] ?? {}), []);

// ---------- 4. Rule scope changes every date, and keeps overrides ----------
console.log("\n== rule scope ==");
const rent = base.recurring.find((r) => r.id === "r-rent");
const ruleDraft = { ...draftOf(rent), amount: "1500" };
const afterRule = saveItem(ruleDraft, rent)(base);
eq("the rule's amount moves", afterRule.recurring.find((r) => r.id === "r-rent").amount, 1500);
eq("...and the dated override SURVIVES it", overrideAt(afterRule, "r-rent", "2026-12-01"), 1600);
eq("editing in place does not duplicate the item", afterRule.recurring.length, base.recurring.length);
eq("...and keeps its id, so its overrides still point at it",
  afterRule.recurring.filter((r) => r.id === "r-rent").length, 1);

// ---------- 5. Moving the day orphans dated amounts, and says so first ----
console.log("\n== moving a rule's day ==");
const moved = { ...draftOf(rent), startDate: "2026-04-09" };
eq("the orphan count is available BEFORE the save, not after",
  orphansIfSaved(base, moved, rent, "2027-02-01"), ["2026-12-01"]);
eq("a change that does not move the day orphans nothing",
  orphansIfSaved(base, { ...draftOf(rent), amount: "99" }, rent, "2027-02-01"), []);
eq("adding a brand-new item can orphan nothing at all",
  orphansIfSaved(base, blankDraft("2026-10-01"), null, "2027-02-01"), []);

// ---------- 6. Adding ----------
console.log("\n== adding ==");
const add = { ...blankDraft("2026-11-20"), name: "  Gym  ", amount: "32", category: "bill" };
const added = saveItem(add, null)(base);
const gym = added.oneoffs.find((o) => o.name === "Gym");
eq("a one-off is added with its name trimmed and its date kept",
  [gym.name, gym.amount, gym.date, gym.category], ["Gym", 32, "2026-11-20", "bill"]);
eq("nothing else moved", added.recurring.length, base.recurring.length);
const addRec = { ...add, recurring: true, cadence: "monthly", startDate: "2026-11-20" };
const addedRec = saveItem(addRec, null)(base);
const gymRule = addedRec.recurring.find((r) => r.name === "Gym");
eq("a recurring item takes its day-of-month FROM the start date",
  [gymRule.cadence, gymRule.startDate, gymRule.dayOfMonth], ["monthly", "2026-11-20", 20]);
eq("...and an empty end date is stored as null, never as \"\"", gymRule.endDate, null);
is("two adds in a row produce two items, not one overwriting the other",
  saveItem(add, null)(saveItem(add, null)(base)).oneoffs.length === base.oneoffs.length + 2);

// ---------- 7. Validation, including the wrong input ----------
console.log("\n== what the sheet refuses ==");
eq("a nameless item", draftError({ ...add, name: "   " }), "Give it a name.");
eq("an empty amount", draftError({ ...add, amount: "" }), "Enter an amount.");
eq("letters in the amount", draftError({ ...add, amount: "twelve" }), "Enter an amount.");
eq("an end date before the start", draftError({ ...addRec, endDate: "2026-01-01" }), "The end date is before the start date.");
eq("a good draft", draftError(add), null);
eq("an empty override amount", overrideError(""), "Enter an amount.");
eq("a good override amount", overrideError("12.50"), null);

// ---------- 8. Track-actuals is resolved against the real categories -----
console.log("\n== track actual vs. budgeted ==");
is("a fixed bill can be tracked", canTrackActuals(base, "bill"));
is("a loan can be tracked", canTrackActuals(base, "c-loan"));
is("a savings category cannot", !canTrackActuals(base, "c-save"));
is("income cannot", !canTrackActuals(base, "income"));
eq("the flag is dropped when the category cannot carry it, not trusted from the form",
  itemFrom({ ...addRec, category: "c-save", variable: true }, null, canTrackActuals(base, "c-save")).variable, false);
eq("...and kept when it can",
  itemFrom({ ...addRec, category: "c-loan", variable: true }, null, canTrackActuals(base, "c-loan")).variable, true);

// ---------- 9. Deleting ----------
console.log("\n== deleting ==");
const deleted = removeItem("r-rent")(base);
eq("the rule is gone", deleted.recurring.filter((r) => r.id === "r-rent").length, 0);
eq("every date it generated is gone with it",
  computeLedger(deleted, "2027-02-01").rows.filter((r) => r.name === "Rent").length, 0);
eq("deleting a one-off leaves the rules alone",
  removeItem("o-dent")(base).recurring.length, base.recurring.length);

// ---------- 10. Prove the harness can fail ----------
console.log("\n== the harness itself ==");
{
  // The bug that shipped: strip the date and treat an occurrence edit as a
  // rule edit. If this file could not tell the difference, nothing above
  // means anything.
  const wrong = saveItem({ ...draftOf(rent), amount: "1500" }, rent)(base);
  const right = saveOccurrence("r-rent", "2026-11-01", "1500")(base);
  is("an occurrence edit and a rule edit produce DIFFERENT states",
    show(wrong.recurring) !== show(right.recurring));
  is("...and the test above would have caught the wrong one",
    wrong.recurring.find((r) => r.id === "r-rent").amount !== 1450);
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
