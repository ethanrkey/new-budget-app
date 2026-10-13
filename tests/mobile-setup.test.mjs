// The phone's setup flow, tested without a renderer.
//
//   node tests/mobile-setup.test.mjs     (runs in `npm test`, so in CI)
//
// What the six screens MEAN lives in mobile/lib/setup.ts, and nearly
// all of what they CREATE is shared with the web and tested in
// tests/setup.test.mjs. So this file covers the seam: which step
// builds what, which steps gate and on what, and the question Phase 3
// turns on — should a new account be met with this at all.
//
// The Back button is the reason for most of it. The web's wizard
// commits each answer as it passes and can never go back; a phone flow
// that shows one question at a time has to, and a Back button creates
// one bug for free — passing a step twice adding its rules twice.
import { normalize } from "../src/engine/stateShape.ts";
import { applySetup } from "../src/engine/setup.ts";
import { updateAccountBalance, upsertItem } from "../src/engine/mutate.ts";
import {
  STEPS, blankSetupDraft, rulesForStep, canAdvance, accountRowErrors,
  setupAnswers, shouldRunSetup,
} from "../mobile/lib/setup.ts";

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

const TODAY = "2026-10-13";
const blank = normalize({});
const draft = () => blankSetupDraft(TODAY);

// ---- the questions, and their order ---------------------------------
eq("six questions", [...STEPS], ["paycheck", "rent", "bills", "groceries", "balance", "accounts"]);
// The ordering decision: accounts last, so quitting there still leaves
// a working forecast. Worth an assertion rather than a comment, because
// reordering the list is a one-line change that costs nothing visible.
eq("the balance comes before the accounts step", STEPS.indexOf("balance") < STEPS.indexOf("accounts"), true);

// ---- the blank draft ------------------------------------------------
{
  const d = draft();
  eq("rent defaults to the 1st, not to today", d.rentDay, "1");
  eq("a bill's due day defaults to today, visibly", d.bills[0].day, "13");
  eq("one empty bill row", d.bills.length, 1);
  eq("and one empty row in each account group",
    Object.values(d.accounts).map((g) => g.length), [1, 1, 1]);
  eq("nothing is created from an untouched draft",
    STEPS.flatMap((s) => rulesForStep(s, d, TODAY)), []);
}

// ---- each step builds its own rule and nothing else ------------------
{
  const d = { ...draft(), payAmount: "2100", rentAmount: "1450", groceryAmount: "150" };
  eq("paycheck", rulesForStep("paycheck", d, TODAY).map((r) => r.name), ["Paycheck"]);
  eq("rent", rulesForStep("rent", d, TODAY).map((r) => r.name), ["Rent"]);
  eq("groceries", rulesForStep("groceries", d, TODAY).map((r) => r.name), ["Groceries"]);
  // The balance is the anchor, not a rule. Reading it off the draft at
  // the end is what lets Back change it.
  eq("the balance step builds no rule", rulesForStep("balance", { ...d, balance: "4000" }, TODAY), []);
  eq("the accounts step builds no rule", rulesForStep("accounts", d, TODAY), []);
}
{
  const d = { ...draft(), bills: [
    { name: "Spotify", amount: "11.99", day: "4" },
    { name: "Internet", amount: "70", day: "20" },
    { name: "", amount: "", day: "13" },
  ] };
  eq("every filled bill row becomes a rule",
    rulesForStep("bills", d, TODAY).map((r) => `${r.name}/${r.dayOfMonth}`), ["Spotify/4", "Internet/20"]);
}

// ---- which steps gate, and on what ----------------------------------
{
  const d = draft();
  for (const s of ["paycheck", "rent", "bills", "groceries"]) {
    is(`${s} can always be passed`, canAdvance(s, d));
  }
  not("the balance step cannot be passed empty", canAdvance("balance", d));
  is("...nor by junk", !canAdvance("balance", { ...d, balance: "abc" }));
  is("...but zero IS an answer", canAdvance("balance", { ...d, balance: "0" }));
  is("...and so is an overdraft", canAdvance("balance", { ...d, balance: "-40" }));
  is("an untouched accounts step finishes", canAdvance("accounts", d));
}
{
  // The bug a real user found: an amount with no name.
  const d = { ...draft(), accounts: { ...draft().accounts, savings: [{ name: "", amount: "8200" }] } };
  not("a half-filled account row blocks Finish", canAdvance("accounts", d));
  eq("...and the row says which half is missing", accountRowErrors(d), { "savings:0": "name" });

  const e = { ...draft(), accounts: { ...draft().accounts, debt: [{ name: "Car loan", amount: "" }] } };
  eq("the other half, too", accountRowErrors(e), { "debt:0": "amount" });

  // Only the started row is flagged; the two untouched groups are not.
  eq("untouched rows are not errors", Object.keys(accountRowErrors(draft())).length, 0);
}

// ---- the answers the flow hands to applySetup ------------------------
{
  const d = {
    ...draft(), payAmount: "2100", balance: "4000",
    accounts: { ...draft().accounts, savings: [{ name: "Ally", amount: "8200" }] },
  };
  const collected = [...rulesForStep("paycheck", d, TODAY)];
  const answers = setupAnswers(collected, d);
  eq("the rules collected are carried", answers.recurring.length, 1);
  eq("setup never creates one-offs", answers.oneoffs, []);
  eq("the anchor is read off the field", answers.checkInBalance, 4000);
  eq("and the finished account rows come with it", answers.accounts, [{ name: "Ally", amount: 8200, group: "savings" }]);

  const out = applySetup(blank, answers, TODAY);
  eq("which applySetup turns into a working account", out.recurring.length, 1);
  eq("the anchor lands", out.accounts[0].balance, 4000);
  eq("and only the named account survives", out.trackerCategories.map((c) => c.name), ["Ally"]);
}
{
  // Skipping everything but the balance is a legal run and must still
  // leave the one number the forecast is built from.
  const answers = setupAnswers([], { ...draft(), balance: "0" });
  eq("a skipped-through run still carries the balance", answers.checkInBalance, 0);
  eq("...and nothing else", [answers.recurring.length, answers.accounts.length], [0, 0]);
}

// ---- Phase 3: should the flow run at all? ----------------------------
{
  is("a brand-new account gets the flow", shouldRunSetup(blank, false));
  not("...but not once it has been put away on this device", shouldRunSetup(blank, true));

  // The web's own gate is account data, so setup done THERE counts here.
  const seen = { ...blank, settings: { ...blank.settings, hasSeenOnboarding: true } };
  not("an account that has already seen setup is not asked again", shouldRunSetup(seen, false));

  // Belt and braces for an account that predates the flag: asking a
  // real user to set up a budget they already have would be worse than
  // not asking a new one.
  const used = upsertItem(blank, {
    id: "r1", name: "Rent", amount: 1450, category: "bill",
    cadence: "monthly", dayOfMonth: 1, startDate: "2026-01-01",
  });
  not("an account with rules in it is never asked", shouldRunSetup(used, false));
  const anchored = updateAccountBalance(blank, "checking", 4000, TODAY);
  not("...nor one with a logged balance", shouldRunSetup(anchored, false));
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
