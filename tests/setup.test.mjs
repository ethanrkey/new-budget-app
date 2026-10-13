// What setup CREATES — the shared definition both clients call.
//
//   node tests/setup.test.mjs     (runs in `npm test`, so in CI)
//
// This logic spent its life inside a React component, where no harness
// could reach it, and it encodes three decisions that a second
// implementation would lose by omission rather than by disagreement.
// Extracting it to engine/setup.ts for the phone is the first time it
// has been testable at all, so the tests are the point of the move as
// much as the sharing is.
import { normalize } from "../src/engine/stateShape.ts";
import {
  applySetup, paycheckRule, rentRule, billRules, groceryRule, balanceAnswer,
  blankAccountRows, startedAccountRows, incompleteAccountRows, collectAccounts,
} from "../src/engine/setup.ts";
import { addBalanceSnapshot } from "../src/engine/mutate.ts";
import { computeLedger } from "../src/engine/compute.ts";

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
const names = (s) => s.trackerCategories.map((c) => c.name).sort();
const byName = (s, n) => s.trackerCategories.find((c) => c.name === n);

const PAY = {
  id: "r-pay", name: "Paycheck", amount: 2100, category: "income",
  cadence: "biweekly", startDate: "2026-10-09", order: 0,
};
const RENT = {
  id: "r-rent", name: "Rent", amount: 1450, category: "bill",
  cadence: "monthly", dayOfMonth: 1, startDate: "2026-10-01", order: 1,
};

// ---- the seeded hints ------------------------------------------------
eq("a new account is seeded with three categories", names(blank), ["Debt", "Investments", "Savings"]);

// ---- the whole thing, as the wizard sends it -------------------------
{
  const out = applySetup(blank, {
    recurring: [PAY, RENT],
    checkInBalance: "4000",
    accounts: [
      { name: "Ally Savings", amount: 8200, group: "savings" },
      { name: "Roth IRA", amount: 15400, group: "investment" },
      { name: "Car loan", amount: 9100, group: "debt" },
    ],
  }, TODAY);

  eq("both rules are created", out.recurring.length, 2);
  eq("the anchor is set to the number given", out.accounts[0].balance, 4000);
  eq("...and dated the day it was given, not the day it is read", out.accounts[0].balanceAsOf, TODAY);

  // The seeded hints are gone and only what was asked for remains.
  eq("the three named accounts exist and the hints do not",
    names(out), ["Ally Savings", "Car loan", "Roth IRA"]);
  eq("savings is an asset", byName(out, "Ally Savings").kind, "asset");
  eq("...of the right kind", byName(out, "Ally Savings").assetKind, "savings");
  eq("investments too", byName(out, "Roth IRA").assetKind, "investment");
  eq("debt is a debt", byName(out, "Car loan").kind, "debt");

  // DECISION 2, and the reason is in the engine file: principal, APR and
  // a start date during setup is where people give up. The loan card
  // asks later, when there is something to point at.
  const loan = byName(out, "Car loan");
  eq("the loan has NO terms", [loan.originalPrincipal, loan.apr, loan.loanStart], [undefined, undefined, undefined]);
  eq("...but it does have what you owe", out.balanceSnapshots[loan.id][0].amount, 9100);

  // The forecast actually runs afterward, which is the only outcome
  // that matters to someone who just finished setup.
  const ledger = computeLedger(out, "2026-12-31");
  is("the ledger has rows the moment setup finishes", ledger.rows.length > 0);
  // And the running balance starts from the anchor rather than zero,
  // which is the difference between a forecast and a guess.
  is("...counting forward from the anchor", ledger.rows[0].balance !== ledger.rows[0].amount);
}

// ---- DECISION 1: reuse a seeded name, but only when it is empty ------
{
  // The bug this prevents reached a real user: a row called "Savings"
  // made a SECOND category of that name, and the Dashboard showed two,
  // one permanently empty.
  const out = applySetup(blank, { accounts: [{ name: "Savings", amount: 500, group: "savings" }] }, TODAY);
  eq("a row named like a hint does not make a second one", names(out), ["Savings"]);
  eq("and it carries the balance", Object.values(out.balanceSnapshots)[0][0].amount, 500);
}
{
  // The limit on that reuse. A same-named category WITH history is
  // somebody's real data, and writing into it on a name collision is
  // the worse bug of the two.
  const used = addBalanceSnapshot(blank, byName(blank, "Savings").id, 3300, "2026-09-01");
  const out = applySetup(used, { accounts: [{ name: "Savings", amount: 500, group: "savings" }] }, TODAY);
  eq("a same-named category WITH data is not reused", names(out).filter((n) => n === "Savings").length, 2);
  const kept = out.trackerCategories.find((c) => c.id === byName(blank, "Savings").id);
  eq("...and the original keeps its own history untouched",
    out.balanceSnapshots[kept.id].map((s) => s.amount), [3300]);
}
{
  // Kind has to match too: a debt row must not swallow the empty
  // "Savings" asset just because the names collide.
  const out = applySetup(blank, { accounts: [{ name: "Savings", amount: 400, group: "debt" }] }, TODAY);
  eq("a debt row does not reuse an asset of the same name", byName(out, "Savings").kind, "debt");
}

// ---- DECISION 3: unused hints are cleaned up, used ones are not ------
{
  const out = applySetup(blank, { accounts: [{ name: "Roth IRA", amount: 100, group: "investment" }] }, TODAY);
  eq("every untouched hint is removed", names(out), ["Roth IRA"]);
}
{
  // Never a category carrying data, even if it is named like a hint.
  const used = addBalanceSnapshot(blank, byName(blank, "Debt").id, 1200, "2026-09-01");
  const out = applySetup(used, {}, TODAY);
  eq("a hint with a logged balance survives the cleanup", names(out), ["Debt"]);
}

// ---- quitting early ---------------------------------------------------
{
  // The accounts step runs last so that someone who stops before it
  // still leaves with a working forecast. That is the whole reason for
  // the ordering, so it is worth an assertion rather than a comment.
  const out = applySetup(blank, { recurring: [PAY, RENT], checkInBalance: 4000 }, TODAY);
  eq("the anchor is set", out.accounts[0].balance, 4000);
  is("and the forecast runs", computeLedger(out, "2026-12-31").rows.length > 0);
}
{
  // Nothing at all must not throw and must not damage the account.
  const out = applySetup(blank, {}, TODAY);
  eq("empty answers leave the balance alone", out.accounts[0].balance, 0);
}

// ---- the anchor is only written when a number was actually given -----
{
  for (const bad of [null, undefined, "", "   ", "abc"]) {
    const out = applySetup(blank, { checkInBalance: bad }, TODAY);
    // "" and "   " are Number()-able to 0 and NaN respectively; what
    // matters is that nothing writes a junk anchor, since the anchor is
    // the number every projected row counts forward from.
    const wrote = out.accounts[0].balance !== 0 || out.accounts[0].balanceAsOf !== blank.accounts[0].balanceAsOf;
    not(`checkInBalance ${show(bad)} does not corrupt the anchor`, wrote && Number.isNaN(Number(bad)));
  }
  eq("a zero balance IS written, because zero is an answer",
    applySetup(blank, { checkInBalance: 0 }, TODAY).accounts[0].balanceAsOf, TODAY);
}


// =====================================================================
// WHAT THE ANSWERS MEAN — the builders both clients call, added with
// the phone's flow 2026-10-13. These used to be inline in
// Onboarding.jsx, where a second implementation could only match them
// by reading them carefully, and three of them encode a judgment that
// is easy to get backwards.

// ---- a blank field is a skipped question, not a zero ----------------
{
  for (const bad of ["", "   ", "abc", "0", "-50"]) {
    eq(`a paycheck of ${show(bad)} creates no rule`, paycheckRule(bad, "biweekly", TODAY), null);
    eq(`rent of ${show(bad)} creates no rule`, rentRule(bad, "1", TODAY), null);
    eq(`groceries of ${show(bad)} creates no rule`, groceryRule(bad, "weekly", TODAY), null);
  }
  eq("a bill row with no amount is dropped", billRules([{ name: "Spotify", amount: "", day: "4" }], TODAY), []);
  eq("a bill row with no name is dropped", billRules([{ name: "  ", amount: "12", day: "4" }], TODAY), []);
}

// ---- the balance step is the exception: zero IS an answer -----------
{
  eq("an empty balance is not an answer", balanceAnswer("   "), null);
  eq("a junk balance is not an answer", balanceAnswer("abc"), null);
  eq("zero is an answer", balanceAnswer("0"), 0);
  eq("and so is a negative one — overdrafts are real", balanceAnswer("-120.50"), -120.5);
}

// ---- each rule is the rule the web has always built ------------------
{
  const pay = paycheckRule("2100", "biweekly", TODAY);
  eq("the paycheck is income", pay.category, "income");
  eq("...named Paycheck", pay.name, "Paycheck");
  eq("...on the cadence chosen", pay.cadence, "biweekly");
  eq("...starting today", pay.startDate, TODAY);
  eq("...on today's day of the month", pay.dayOfMonth, 12);
  eq("...and carries no order — upsertItem assigns it", pay.order, undefined);

  const groc = groceryRule("150", "weekly", TODAY);
  eq("groceries are a bill, not a category of their own", groc.category, "bill");
  eq("...on the cadence chosen", groc.cadence, "weekly");
}

// ---- rent's day, which the ledger's ordering turns on -----------------
{
  eq("the day asked for is the day stored", rentRule("1450", "15", TODAY).dayOfMonth, 15);
  eq("...and the first occurrence lands on it", rentRule("1450", "15", TODAY).startDate, "2026-10-15");
  // Clamped into a real month rather than rolling into the next one.
  eq("the 31st of a 30-day month starts on the 30th", rentRule("1450", "31", "2026-11-05").startDate, "2026-11-30");
  eq("...but the rule still remembers the 31st", rentRule("1450", "31", "2026-11-05").dayOfMonth, 31);
  eq("a nonsense day falls back to the 1st", rentRule("1450", "", TODAY).dayOfMonth, 1);
  eq("...and 99 is clamped, not stored", rentRule("1450", "99", TODAY).dayOfMonth, 31);
}

// ---- the bills step's defaulted day is TODAY, shown not guessed ------
{
  const rows = [
    { name: "Spotify", amount: "11.99", day: "4" },
    { name: " Internet ", amount: "70", day: "" },
  ];
  const out = billRules(rows, TODAY);
  eq("both rows become rules", out.length, 2);
  eq("the typed day is kept", out[0].dayOfMonth, 4);
  eq("an empty day falls back to today's", out[1].dayOfMonth, 12);
  eq("the name is trimmed", out[1].name, "Internet");
  eq("every bill is monthly", out.map((r) => r.cadence), ["monthly", "monthly"]);
}

// ---- the accounts step: a half-filled row blocks, never drops --------
{
  const rows = blankAccountRows();
  eq("three groups, one empty row each", Object.keys(rows).sort(), ["debt", "investment", "savings"]);
  eq("empty rows are not started", startedAccountRows(rows).length, 0);
  eq("...so an untouched step finishes", incompleteAccountRows(rows).length, 0);
  eq("...and creates nothing", collectAccounts(rows), []);

  // THE BUG THIS EXISTS FOR: an amount with no name used to vanish.
  const amountOnly = { ...rows, savings: [{ name: "", amount: "8200" }] };
  eq("an amount with no name IS a started row", startedAccountRows(amountOnly).length, 1);
  eq("...and it blocks Finish rather than being dropped", incompleteAccountRows(amountOnly).length, 1);
  eq("...and nothing is created from it", collectAccounts(amountOnly), []);

  const nameOnly = { ...rows, debt: [{ name: "Car loan", amount: "" }] };
  eq("a name with no amount also blocks", incompleteAccountRows(nameOnly).length, 1);

  const junk = { ...rows, savings: [{ name: "Ally", amount: "abc" }] };
  eq("an unparseable amount blocks too", incompleteAccountRows(junk).length, 1);
}
{
  const rows = {
    savings: [{ name: " Ally Savings ", amount: "8200" }, { name: "", amount: "" }],
    investment: [{ name: "Roth IRA", amount: "15400" }],
    debt: [{ name: "Car loan", amount: "9100" }],
  };
  eq("finished rows survive and are trimmed", collectAccounts(rows), [
    { name: "Ally Savings", amount: 8200, group: "savings" },
    { name: "Roth IRA", amount: 15400, group: "investment" },
    { name: "Car loan", amount: 9100, group: "debt" },
  ]);
  eq("the trailing empty row does not block Finish", incompleteAccountRows(rows).length, 0);
  // A zero is a real balance on this step, unlike an amount field.
  eq("zero in an account row is kept",
    collectAccounts({ ...rows, savings: [{ name: "Emergency", amount: "0" }] })[0].amount, 0);
}

// ---- end to end: the builders feed applySetup ------------------------
{
  const answers = {
    recurring: [paycheckRule("2100", "biweekly", TODAY), rentRule("1450", "1", TODAY),
      ...billRules([{ name: "Spotify", amount: "11.99", day: "4" }], TODAY),
      groceryRule("150", "weekly", TODAY)],
    oneoffs: [],
    checkInBalance: balanceAnswer("4000"),
    accounts: collectAccounts({
      savings: [{ name: "Ally Savings", amount: "8200" }],
      investment: [{ name: "", amount: "" }],
      debt: [{ name: "", amount: "" }],
    }),
  };
  const out = applySetup(blank, answers, TODAY);
  eq("four rules land", out.recurring.length, 4);
  eq("every rule got an order", out.recurring.map((r) => r.order), [0, 1, 2, 3]);
  eq("every rule got the primary account", [...new Set(out.recurring.map((r) => r.accountId))], ["checking"]);
  eq("the anchor is the number typed", out.accounts[0].balance, 4000);
  eq("the one named account is the only one left", names(out), ["Ally Savings"]);
  is("and the forecast runs", computeLedger(out, "2026-12-31").rows.length > 0);
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
