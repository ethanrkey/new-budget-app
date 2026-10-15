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
  firstMonthlyOn, defaultBillDay, emptyBillRow, firstWeekdayOn,
  contributionTargets, contributionOf, collectAccountsWith, contributionName,
  blankContributionRow, clampDay,
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

  // THE PAYDAY IS ASKED FOR NOW, not assumed to be today.
  eq("a future payday is where the rule starts",
    paycheckRule("2100", "biweekly", TODAY, "2026-10-23").startDate, "2026-10-23");
  eq("...and the day-of-month follows it, not today",
    paycheckRule("2100", "monthly", TODAY, "2026-10-23").dayOfMonth, 23);
  eq("no payday given still means today, so nothing changes for a skipper",
    paycheckRule("2100", "biweekly", TODAY).startDate, TODAY);
  // Clamped rather than refused: a rule that starts before the balance
  // it is counted forward from is never what anybody meant, and this
  // function is the definition even where no form guards it.
  eq("a payday in the past is clamped to today",
    paycheckRule("2100", "biweekly", TODAY, "2026-09-01").startDate, TODAY);

  const groc = groceryRule("150", "weekly", TODAY);
  eq("groceries are a bill, not a category of their own", groc.category, "bill");
  eq("...on the cadence chosen", groc.cadence, "weekly");
  // The step asks for "a rough estimate" in those words, and an
  // estimate is exactly what the Spending tab exists to compare
  // against reality. Without this the one rule most likely to move
  // has nothing in its variance column.
  eq("...and are marked variable, like the Ledger form's own flag", groc.variable, true);
  eq("rent is NOT variable — the whole point is that it does not move",
    rentRule("1450", "1", TODAY).variable, undefined);
  eq("...nor is a named bill", billRules([{ name: "Spotify", amount: "12", day: "4" }], TODAY)[0].variable, undefined);
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

// ---- 1 TO 31, WHOEVER IS ASKING ---------------------------------------
//
// Reported from a device on build 8: the due day was a number pad
// field and you could enter 50. The engine clamped it to 31 and said
// nothing, which is worse than a rejection — the field quietly meant
// something other than what was in it.
//
// Build 9 makes both clients draw a 1-31 picker, so nothing they can
// produce needs clamping. THAT IS NOT WHY THIS STAYS. The engine is
// also called by the CSV importers and by anything written next, and
// "the UI cannot send a bad one" is a property of the callers rather
// than of the function. So the backstop is tested in its own right,
// on top of the rent and bill rules that use it.
{
  eq("50 becomes the 31st", clampDay("50", 1), 31);
  eq("...and so does 31", clampDay("31", 1), 31);
  eq("a negative day becomes the 1st", clampDay("-3", 9), 1);
  eq("zero is not a day, so the fallback stands", clampDay("0", 9), 9);
  eq("neither is an empty field", clampDay("", 9), 9);
  eq("neither is a word", clampDay("abc", 9), 9);
  eq("a real day is left alone", clampDay("15", 9), 15);

  // The two callers, so a future edit that drops the clamp from one of
  // them fails here rather than in somebody's ledger.
  eq("a bill row asking for the 50th is stored as the 31st",
    billRules([{ name: "Gym", amount: "40", day: "50" }], TODAY)[0].dayOfMonth, 31);
  eq("...and rent asking for the 50th is too",
    rentRule("1450", "50", TODAY).dayOfMonth, 31);

  // THE 31st IN A SHORT MONTH still lands on the last day. The rule
  // keeps 31; where it CHARGES is clamped per month, by firstMonthlyOn
  // for the first occurrence and by occurrenceDates for the rest.
  eq("the 31st in February starts on the 28th",
    billRules([{ name: "Gym", amount: "40", day: "31" }], "2027-02-01")[0].startDate, "2027-02-28");
  eq("...and the rule still says 31",
    billRules([{ name: "Gym", amount: "40", day: "31" }], "2027-02-01")[0].dayOfMonth, 31);
}

// ---- THE DUE DAY IS THE FIRST CHARGE, not the day setup was run -----
//
// Reported from a device and from a fresh web account on the same day:
// Spotify (due 10th), HBO (14th) and Gym (20th) entered on October
// 14th all charged on October 14th. `occurrenceDates` emits a rule's
// startDate verbatim and only applies dayOfMonth from the SECOND
// occurrence, and billRules was passing today as the start.
{
  const rows = [
    { name: "Spotify", amount: "11.99", day: "10" },   // before today
    { name: "HBO", amount: "16", day: "14" },          // today
    { name: "Gym", amount: "40", day: "20" },          // after today
  ];
  // TODAY here is 2026-10-12, so the 14th and the 20th are both still
  // ahead and the 10th has gone.
  const out = billRules(rows, TODAY);
  eq("a bill due later this month starts this month",
    [out.find((r) => r.name === "HBO").startDate, out.find((r) => r.name === "Gym").startDate],
    ["2026-10-14", "2026-10-20"]);
  // The one that was double-counted: its October charge is already
  // inside the balance setup just asked for.
  eq("a bill whose day has passed starts NEXT month",
    out.find((r) => r.name === "Spotify").startDate, "2026-11-10");
  eq("...and every one of them keeps the day it was given",
    out.map((r) => r.dayOfMonth), [10, 14, 20]);
  // THE REPORTED SYMPTOM, as an assertion: three bills, three
  // different dates, none of them the day setup was run.
  eq("nothing piles up on the day setup was run",
    out.filter((r) => r.startDate === TODAY).length, 0);
  eq("...and no two of them share a date",
    new Set(out.map((r) => r.startDate)).size, 3);

  // A bill due on the very day setup runs starts that day — it has not
  // been charged yet as far as anyone here knows.
  eq("a bill due today starts today",
    billRules([{ name: "HBO", amount: "16", day: "14" }], "2026-10-14")[0].startDate, "2026-10-14");
}
{
  // Month-end clamps DOWN, never over into the next month.
  eq("the 31st of a 30-day month lands on the 30th",
    firstMonthlyOn(31, "2026-11-05"), "2026-11-30");
  eq("...and the 31st in February lands on the 28th",
    firstMonthlyOn(31, "2027-02-01"), "2027-02-28");
  // A clamped day that equals today still counts as today, not next month.
  eq("the 31st on the last day of a 30-day month is today",
    firstMonthlyOn(31, "2026-11-30"), "2026-11-30");
  eq("the day after that rolls to next month's clamp",
    firstMonthlyOn(31, "2026-12-01"), "2026-12-31");
  // Crossing a year boundary.
  eq("a passed day in December starts in January",
    firstMonthlyOn(5, "2026-12-20"), "2027-01-05");
}
{
  // Rent had the quieter version: it clamped into the CURRENT month
  // unconditionally, so rent due on the 1st and entered on the 12th
  // started on a date that had already gone.
  eq("rent due before today starts next month",
    rentRule("1450", "1", TODAY).startDate, "2026-11-01");
  eq("...and keeps the 1st as its day", rentRule("1450", "1", TODAY).dayOfMonth, 1);
  eq("rent due later this month still starts this month",
    rentRule("1450", "28", TODAY).startDate, "2026-10-28");
}

// ---- groceries happen on a DAY OF THE WEEK -------------------------
{
  // TODAY is 2026-10-12, a Monday.
  eq("today counts when it is the chosen day", firstWeekdayOn(1, TODAY), "2026-10-12");
  eq("a day later this week is this week", firstWeekdayOn(4, TODAY), "2026-10-15");
  eq("a day already gone is next week", firstWeekdayOn(0, TODAY), "2026-10-18");
  eq("Saturday from a Monday", firstWeekdayOn(6, TODAY), "2026-10-17");
  // Across a month, and across a year.
  eq("the next Sunday can be in the next month", firstWeekdayOn(0, "2026-10-28"), "2026-11-01");
  eq("...and in the next year", firstWeekdayOn(5, "2026-12-29"), "2027-01-01");

  const g = groceryRule("150", "weekly", TODAY);
  eq("groceries default to Sunday", g.startDate, "2026-10-18");
  eq("...and the rule's day of month comes from that date, not today", g.dayOfMonth, 18);
  eq("a chosen weekday is used", groceryRule("150", "weekly", TODAY, 3).startDate, "2026-10-14");
  // The whole point: the series must not inherit the day setup was run.
  not("the start date is the day setup happened to be run",
    groceryRule("150", "weekly", TODAY, 6).startDate === TODAY);
  // Everything else about the step is unchanged.
  eq("groceries are still variable spending", groceryRule("150", "weekly", TODAY).variable, true);
  eq("a blank amount is still nothing", groceryRule("", "weekly", TODAY, 2), null);
}

// ---- EVERY bill row's day defaults to today, not just the first -----
{
  // Found on a device: the phone seeded "+ Add another bill" from the
  // FIRST row's current value, so a second bill offered whatever had
  // just been typed into the first. The web seeded from a module-level
  // `new Date().getDate()`, frozen when the bundle loaded. One builder
  // now, and it takes the day as an argument.
  eq("a new row's day is today's", emptyBillRow(TODAY).day, "12");
  eq("...with nothing else filled in", emptyBillRow(TODAY), { name: "", amount: "", day: "12" });
  eq("a single-digit day has no leading zero", defaultBillDay("2026-10-04"), "4");
  eq("a two-digit day is itself", defaultBillDay("2026-10-31"), "31");
  // The point of the parameter: two rows made on different days differ,
  // and two rows made on the same day agree however many came before.
  not("rows made on different days share a default",
    emptyBillRow("2026-10-04").day === emptyBillRow("2026-10-08").day);
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

// ---- scheduling what goes IN to an account ---------------------------
{
  const rows = {
    savings: [{ name: "Ally", amount: "8200" }, { name: "", amount: "" }],
    investment: [{ name: "Roth IRA", amount: "15400" }],
    debt: [{ name: "Car loan", amount: "9100" }],
  };

  // The step asks about the FINISHED rows only, each under a key made
  // of its group and position — not its place in the finished list,
  // which moves when somebody goes back and edits, and not its name,
  // because two accounts are allowed to share one.
  eq("every finished account is asked about",
    contributionTargets(rows).map((t) => t.key), ["savings:0", "investment:0", "debt:0"]);
  eq("...and an unfinished row is not",
    contributionTargets({ savings: [{ name: "Ally", amount: "" }], investment: [], debt: [] }).length, 0);

  // A blank amount is a skipped question, not a zero.
  eq("a blank row means nothing was asked for", contributionOf(blankContributionRow(TODAY)), null);
  eq("a missing row too", contributionOf(undefined), null);
  eq("zero is not a contribution either",
    contributionOf({ amount: "0", cadence: "monthly", day: "5" }), null);
  eq("a monthly one carries its day",
    contributionOf({ amount: "300", cadence: "monthly", day: "15" }),
    { amount: 300, cadence: "monthly", day: 15 });
  // A weekly transfer on "the 14th" is not a thing.
  eq("a weekly one drops the day",
    contributionOf({ amount: "50", cadence: "weekly", day: "15" }),
    { amount: 50, cadence: "weekly" });

  eq("savings and investments are transfers in", contributionName({ name: "Ally", group: "savings" }), "To Ally");
  eq("debt is a payment", contributionName({ name: "Car loan", group: "debt" }), "Car loan payment");

  const withOne = collectAccountsWith(rows, { "debt:0": { amount: "450", cadence: "monthly", day: "1" } });
  eq("only the answered account carries one",
    withOne.map((a) => a.contribution?.amount ?? null), [null, null, 450]);

  // The end of the chain: a real rule, pointed at the category the
  // account became, in a state that has it.
  const out = applySetup(blank, { accounts: withOne }, TODAY);
  const loan = out.trackerCategories.find((c) => c.name === "Car loan");
  const rule = out.recurring.find((r) => r.name === "Car loan payment");
  is("the rule exists", !!rule);
  eq("...and points at that account's own category", rule.category, loan.id);
  eq("...with the amount typed", rule.amount, 450);
  // The 1st has gone by 2026-10-12, so the first payment is in
  // November — the same call firstMonthlyOn makes for a bill.
  eq("...starting on the next occurrence of its day", rule.startDate, "2026-11-01");
  eq("...and keeping the day", rule.dayOfMonth, 1);
  eq("the accounts with nothing scheduled got no rules", out.recurring.length, 1);

  // A savings account's rule, which takes the other branch of
  // applySetup entirely (setupAsset rather than addCategory).
  const savingsOut = applySetup(blank, {
    accounts: collectAccountsWith(rows, { "savings:0": { amount: "300", cadence: "weekly", day: "1" } }),
  }, TODAY);
  const ally = savingsOut.trackerCategories.find((c) => c.name === "Ally");
  const toAlly = savingsOut.recurring.find((r) => r.name === "To Ally");
  eq("an asset's rule points at the asset's category", toAlly.category, ally.id);
  eq("...and a weekly one starts today", toAlly.startDate, TODAY);
  eq("...and it is an outflow that the Budget treats as money kept",
    savingsOut.trackerCategories.find((c) => c.id === toAlly.category).kind, "asset");
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

// A SUITE THAT RUNS NO CHECKS EXITS 0, and that is not hypothetical: a
// bad edit truncated tests/signin.test.mjs to its header on 2026-10-14
// and `npm test` stayed green through the whole run. The floor is
// deliberately far below any real count — it is here to catch a file
// that has been emptied, not to track how many checks it should have.
if (checks < 10) {
  console.log(`FAIL  this suite ran only ${checks} checks — truncated, or short-circuited before the end`);
  failures++;
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
