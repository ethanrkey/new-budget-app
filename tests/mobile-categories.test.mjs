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
  categoryDraftError, setupPayload,
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

// ---- the payload the engine actually takes ---------------------------
{
  const base = blankCategoryDraft(TODAY);
  const asset = setupPayload({ ...base, name: " Roth IRA ", assetKind: "investment", balance: "15400" }, null);
  eq("an asset payload is trimmed and typed", [asset.kind, asset.payload.name, asset.payload.assetKind],
    ["asset", "Roth IRA", "investment"]);
  eq("...and carries its reading with a date", [asset.payload.balance, asset.payload.asOf], [15400, TODAY]);

  // No balance typed means no snapshot. An as-of date with nothing to
  // date is how an empty reading gets written.
  const noBalance = setupPayload({ ...base, name: "Roth IRA" }, null);
  eq("no balance means no date either", [noBalance.payload.balance, noBalance.payload.asOf], [null, null]);

  const loan = setupPayload({ ...base, name: "Car loan", kind: "debt",
    originalPrincipal: "14200", interestRate: "6.4", balance: "9100" }, "c-1");
  eq("a loan payload keeps the id it is editing", loan.payload.categoryId, "c-1");
  eq("...its terms", [loan.payload.originalPrincipal, loan.payload.interestRate], [14200, 6.4]);
  eq("...and what is owed now", [loan.payload.outstanding, loan.payload.asOf], [9100, TODAY]);

  // interestStartDate without a principal is a date for nothing.
  const noPrincipal = setupPayload({ ...base, name: "Card", kind: "debt", interestRate: "22" }, null);
  eq("no original amount means no interest start date", noPrincipal.payload.interestStartDate, null);
}

// ---- and it actually works through the engine ------------------------
{
  const { payload } = setupPayload(
    { ...blankCategoryDraft(TODAY), name: "Roth IRA", assetKind: "investment", balance: "15400" }, null);
  const out = setupAsset(blank, payload);
  const made = out.trackerCategories.find((c) => c.name === "Roth IRA");
  is("setupAsset creates the category", !!made);
  eq("...as an investment", made.assetKind, "investment");
  eq("...with the reading logged", out.balanceSnapshots[made.id][0].amount, 15400);
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
