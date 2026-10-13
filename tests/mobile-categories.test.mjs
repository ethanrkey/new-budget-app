// The phone's account manager, without the form.
//
//   node tests/mobile-categories.test.mjs     (runs in `npm test`, so in CI)
//
// The phone could not call addCategory, updateCategory, deleteCategory,
// moveCategory or setupAsset at all before 2026-10-12, so a phone-only
// user could not add a savings account, an investment or a loan, and
// could not answer the loan card's own prompt for a rate and an
// original amount. Everything here is a decision about that form that
// does not need the form to test.
import { normalize } from "../src/engine/stateShape.ts";
import { setupLoan, setupAsset, addBalanceSnapshot, upsertItem } from "../src/engine/mutate.ts";
import {
  categoryRows, deleteWarning, blankCategoryDraft, draftOfCategory,
  categoryDraftError, applyCategoryDraft,
} from "../mobile/lib/categories.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, c) => eq(label, !!c, true);
const not = (label, c) => eq(label, !!c, false);

const TODAY = "2026-10-12";
const blank = normalize({});
const row = (s, name) => categoryRows(s).find((r) => r.name === name);

// ---- what the list shows ---------------------------------------------
{
  const rows = categoryRows(blank);
  eq("seeded categories come back in order", rows.map((r) => r.name), ["Savings", "Investments", "Debt"]);
  eq("an asset says what kind it is", row(blank, "Savings").sub, "Savings");
  // THE PROMPT THE LOAN CARD MAKES, echoed where the answer lives. A
  // card that asks for terms and a manager that does not mention them
  // is how someone concludes there is nowhere to put them.
  eq("a loan with no terms says so", row(blank, "Debt").sub, "Loan · no rate or original amount yet");

  const withTerms = setupLoan(blank, {
    categoryId: row(blank, "Debt").id, name: "Debt",
    originalPrincipal: 14200, interestRate: 6.4, interestStartDate: "2024-01-01",
  });
  eq("...and stops saying so once they are set", row(withTerms, "Debt").sub, "Loan · terms set");
}

// ---- deleting, and what it costs -------------------------------------
{
  eq("an untouched category is safe to delete",
    deleteWarning(row(blank, "Savings")), "Delete Savings? Nothing is logged against it.");

  const logged = addBalanceSnapshot(blank, row(blank, "Savings").id, 8200, TODAY);
  is("a logged balance is named in the warning", /1 logged balance/.test(deleteWarning(row(logged, "Savings"))));

  // The engine does not refuse this and does not cascade: tagged items
  // survive and show as uncategorized. Surprising, correct, and
  // therefore said in advance.
  const tagged = upsertItem(logged, {
    id: "r-save", name: "To savings", amount: 300, category: row(logged, "Savings").id,
    cadence: "monthly", dayOfMonth: 5, startDate: "2026-01-05", order: 0,
  });
  const warning = deleteWarning(row(tagged, "Savings"));
  is("tagged transactions are counted too", /1 transaction/.test(warning));
  is("...and the warning says they survive as uncategorized", /uncategorized/.test(warning));
}

// ---- the draft -------------------------------------------------------
{
  eq("a blank draft starts as a savings account", blankCategoryDraft(TODAY).kind, "asset");
  eq("...dated today", blankCategoryDraft(TODAY).asOf, TODAY);

  const d = draftOfCategory({ id: "x", name: "Car loan", kind: "debt", order: 0,
    originalPrincipal: 14200, interestRate: 6.4, interestStartDate: "2024-01-01" }, TODAY);
  eq("editing a loan loads its terms", [d.originalPrincipal, d.interestRate, d.interestStartDate],
    ["14200", "6.4", "2024-01-01"]);
  // Balance is deliberately blank on an edit: leaving the last reading
  // in the field invites re-logging a number that has not changed,
  // which is a new snapshot saying nothing.
  eq("...but not a balance", d.balance, "");
}

// ---- validation, which is deliberately permissive about terms --------
{
  const base = blankCategoryDraft(TODAY);
  eq("a nameless category is refused", categoryDraftError({ ...base, name: "  " }), "Give it a name.");
  eq("a name is all it really needs", categoryDraftError({ ...base, name: "Roth IRA" }), null);

  // A loan with no rate is a REAL loan and the app already handles it —
  // the card says what is missing and amortization withholds itself.
  // A form stricter than the data model is unusable for the person
  // whose paperwork is in another room.
  eq("a loan with no terms at all saves",
    categoryDraftError({ ...base, name: "Car loan", kind: "debt" }), null);

  is("a non-numeric amount is refused",
    /number/.test(categoryDraftError({ ...base, name: "x", originalPrincipal: "lots" })));
  is("a negative balance is refused",
    /negative/.test(categoryDraftError({ ...base, name: "x", balance: "-5" })));
  // 7 means 7%. 700 is someone typing the payment.
  is("a rate over 100 is caught as a unit mistake",
    /percentage/.test(categoryDraftError({ ...base, name: "x", kind: "debt", interestRate: "700" })));
  eq("...but a plausible rate passes",
    categoryDraftError({ ...base, name: "x", kind: "debt", interestRate: "6.4" }), null);
}

// ---- the THREE engine paths ------------------------------------------
//
// `SetupLoanInput.originalPrincipal` is required, and it is right to
// be: setupLoan means "set up a loan", and a loan with no principal
// cannot amortize. But a debt with only a name and a balance is a real
// supported state — applySetup creates exactly that from the wizard's
// last step. So the form stays permissive and the branch lives in the
// lib, where this can reach it.
{
  const base = blankCategoryDraft(TODAY);

  // 1. An asset.
  const asset = applyCategoryDraft(blank,
    { ...base, name: " Roth IRA ", assetKind: "investment", balance: "15400" }, null);
  const made = asset.trackerCategories.find((c) => c.name === "Roth IRA");
  is("an asset is created, trimmed", !!made);
  eq("...as an investment", made.assetKind, "investment");
  eq("...with its reading logged", asset.balanceSnapshots[made.id][0].amount, 15400);
  eq("...dated the day given", asset.balanceSnapshots[made.id][0].date, TODAY);

  // 2. A debt WITH a principal goes through setupLoan, terms and all.
  const loan = applyCategoryDraft(blank, {
    ...base, name: "Car loan", kind: "debt",
    originalPrincipal: "14200", interestRate: "6.4", interestStartDate: "2024-01-01", balance: "9100",
  }, null);
  const car = loan.trackerCategories.find((c) => c.name === "Car loan");
  eq("a loan with terms is a debt", car.kind, "debt");
  eq("...and keeps them", [car.originalPrincipal, car.interestRate, car.interestStartDate],
    [14200, 6.4, "2024-01-01"]);
  eq("...and what is owed", loan.balanceSnapshots[car.id][0].amount, 9100);

  // 3. A debt WITHOUT one must still be creatable. This is the path
  // that a required-principal type would have made impossible, and
  // the state the loan card's prompt exists to describe.
  const bare = applyCategoryDraft(blank,
    { ...base, name: "Credit card", kind: "debt", balance: "820" }, null);
  const card = bare.trackerCategories.find((c) => c.name === "Credit card");
  eq("a debt with no terms is still a debt", card.kind, "debt");
  eq("...with no principal invented", card.originalPrincipal, undefined);
  eq("...but the balance logged", bare.balanceSnapshots[card.id][0].amount, 820);
  eq("...and the manager says what is missing",
    categoryRows(bare).find((r) => r.name === "Credit card").sub,
    "Loan · no rate or original amount yet");

  // Half an answer is kept rather than discarded: a rate typed without
  // a principal would otherwise make the form lose what was typed.
  const halfAnswer = applyCategoryDraft(blank,
    { ...base, name: "Card", kind: "debt", interestRate: "22" }, null);
  eq("a rate with no principal survives",
    halfAnswer.trackerCategories.find((c) => c.name === "Card").interestRate, 22);
}

// ---- editing an existing one -----------------------------------------
{
  const base = blankCategoryDraft(TODAY);
  const id = row(blank, "Debt").id;

  // Answering the loan card's prompt: the SAME category gains terms
  // rather than a second one appearing beside it.
  const answered = applyCategoryDraft(blank,
    { ...base, name: "Debt", kind: "debt", originalPrincipal: "14200", interestRate: "6.4" }, id);
  eq("answering the prompt does not make a second category",
    answered.trackerCategories.filter((c) => c.name === "Debt").length, 1);
  eq("...it sets the terms on the one that asked",
    answered.trackerCategories.find((c) => c.id === id).originalPrincipal, 14200);

  // The same thing for a debt that has NO terms yet, which is the path
  // the loan card's prompt actually lands on and a different branch in
  // the lib. Editing it by id must change that category, not make a
  // second one beside it.
  const bare = applyCategoryDraft(blank, { ...base, name: "Credit card", kind: "debt" }, null);
  const cardId = bare.trackerCategories.find((c) => c.name === "Credit card").id;
  const renamedDebt = applyCategoryDraft(bare,
    { ...base, name: "Visa", kind: "debt", balance: "820" }, cardId);
  eq("editing a termless debt does not make a second one",
    renamedDebt.trackerCategories.filter((c) => c.kind === "debt" && c.name !== "Debt").length, 1);
  eq("...it renames the one being edited",
    renamedDebt.trackerCategories.find((c) => c.id === cardId).name, "Visa");
  eq("...and logs the balance against it",
    renamedDebt.balanceSnapshots[cardId][0].amount, 820);

  // Renaming, with no balance typed, must not log an empty reading.
  const renamed = applyCategoryDraft(blank, { ...base, name: "Rainy day", assetKind: "savings" },
    row(blank, "Savings").id);
  eq("a rename keeps the id", renamed.trackerCategories.find((c) => c.name === "Rainy day").id,
    row(blank, "Savings").id);
  eq("...and logs nothing", (renamed.balanceSnapshots?.[row(blank, "Savings").id] ?? []).length, 0);
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
