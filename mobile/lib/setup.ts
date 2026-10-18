import type { BudgetItem, BudgetState } from "../../src/engine/types.ts";
import {
  paycheckRule, rentRule, billRules, groceryRule, balanceAnswer,
  blankAccountRows, incompleteAccountRows, emptyBillRow,
  contributionTargets, collectAccountsWith, blankContributionRow, setupPaycheck,
  DEFAULT_INCOME_NAME,
  type SetupCadence, type BillRow, type AccountRows, type SetupAnswers,
  type ContributionRows,
} from "../../src/engine/setup.ts";
import { todayISO } from "../../src/engine/model.ts";
import { SETUP_STEPS, type SetupStepKey } from "../../src/content/setup.ts";
import { isNewAccount } from "./firstRun.ts";

// The phone's setup flow, minus the React.
//
// Same split as lib/categories.ts and lib/edit.ts: anything that can be
// asserted without a renderer lives here, where the plain-node harness
// runs it in milliseconds, and the component is left with arrangement.
//
// WHAT IS *NOT* HERE is the point. Every question, every string and
// every rule the answers become is shared with the web —
// src/content/setup.ts and src/engine/setup.ts. This file holds three
// things that are genuinely about this client:
//
//   1. the draft: six screens' worth of typed text held at once,
//      because a phone flow you can go BACK through has to remember
//      what you typed, and the web's wizard never could;
//   2. which steps gate, and on what;
//   3. whether the flow should run at all, which is Phase 3's whole
//      question — see shouldRunSetup.

export type { SetupStepKey };
export const STEPS = SETUP_STEPS;

/** Everything typed across the six steps, held at once. */
export type SetupDraft = {
  /** What the income is called. Defaults to the engine's own word. */
  payName: string;
  payAmount: string;
  payCadence: SetupCadence;
  /** The NEXT payday, which setup used to assume was today. */
  payday: string;
  rentAmount: string;
  rentDay: string;
  bills: BillRow[];
  groceryAmount: string;
  groceryCadence: SetupCadence;
  /** Day of the week, Date.getDay() — not a date. See groceryRule. */
  groceryDay: number;
  balance: string;
  accounts: AccountRows;
  /** Keyed by account row — see contributionTargets in the engine. */
  contributions: ContributionRows;
};

export function blankSetupDraft(today: string): SetupDraft {
  return {
    payName: DEFAULT_INCOME_NAME, payAmount: "", payCadence: "biweekly", payday: today,
    // The 1st, like the web: it is right more often than today is, and
    // the ledger's ordering turns on it.
    rentAmount: "", rentDay: "1",
    // A row, from the one place that makes them — see emptyBillRow.
    // Every other row on this step comes from there too, which is the
    // whole reason the second one no longer inherits the first's day.
    bills: [emptyBillRow(today)],
    groceryAmount: "", groceryCadence: "weekly", groceryDay: 0,
    balance: "",
    accounts: blankAccountRows(),
    // Empty, not one-per-account: the accounts do not exist yet, and a
    // row is made the first time the step is drawn for one.
    contributions: {},
  };
}

/**
 * What pressing Continue on this step adds. Skip adds nothing.
 *
 * Returning a LIST for every step, including the ones that can only
 * make one rule, is deliberate: the caller then has a single line that
 * works for all six, and there is no branch anywhere in the component
 * deciding what a step means.
 */
export function rulesForStep(step: SetupStepKey, d: SetupDraft, today: string): BudgetItem[] {
  const one = (r: BudgetItem | null) => (r ? [r] : []);
  switch (step) {
    case "paycheck": return one(paycheckRule(d.payAmount, d.payCadence, today, d.payday, d.payName));
    case "rent": return one(rentRule(d.rentAmount, d.rentDay, today));
    case "bills": return billRules(d.bills, today);
    case "groceries": return one(groceryRule(d.groceryAmount, d.groceryCadence, today, d.groceryDay));
    // The balance is not a rule — it is the anchor, and it is read off
    // the draft at the end rather than accumulated, because it is the
    // one answer that can be changed by going back.
    case "balance": return [];
    case "accounts": return [];
    // The contributions step's rules cannot be built here. They point
    // at tracker categories that do not exist until applySetup has
    // created them, so they are carried on the accounts and built
    // there — see contributionRule in src/engine/setup.ts.
    case "contributions": return [];
  }
}

/**
 * Can this step's primary button be pressed?
 *
 * Only two steps can say no, and for opposite reasons. The balance step
 * cannot be skipped at all: everything in the Ledger is counted forward
 * from that number and a new user's first forecast once projected from
 * zero because the step was passable. The accounts step CAN be empty,
 * but it cannot be half-filled — a row with an amount and no name has
 * to block rather than be dropped, which is the bug a real user found.
 */
export function canAdvance(step: SetupStepKey, d: SetupDraft): boolean {
  if (step === "balance") return balanceAnswer(d.balance) != null;
  if (step === "accounts") return incompleteAccountRows(d.accounts).length === 0;
  return true;
}

/**
 * The steps this run will actually show.
 *
 * Only one is conditional: there is nothing to ask about
 * contributions when no savings, investment or debt account was
 * entered, and a step listing nothing makes the flow look longer
 * than it is. It is last, so a list that grows while somebody is
 * typing on the accounts step never moves the step they are on.
 */
export function stepsFor(d: SetupDraft): SetupStepKey[] {
  return SETUP_STEPS.filter(
    (s) => s !== "contributions" || contributionTargets(d.accounts).length > 0
  );
}

/** A contributions row for `key`, made on demand the first time it is shown. */
export function contributionRowAt(d: SetupDraft, key: string, today: string) {
  return d.contributions[key] ?? blankContributionRow(today);
}

/** Which started account rows are unfinished, by group and index. */
export function accountRowErrors(d: SetupDraft): Record<string, "name" | "amount"> {
  const out: Record<string, "name" | "amount"> = {};
  for (const r of incompleteAccountRows(d.accounts)) {
    out[`${r.group}:${r.index}`] = r.name === "" ? "name" : "amount";
  }
  return out;
}

/** The draft plus whatever Continue collected, in the shape applySetup takes. */
export function setupAnswers(
  collected: BudgetItem[], d: SetupDraft, today: string = todayISO(),
): SetupAnswers {
  return {
    recurring: collected,
    oneoffs: [],
    // Read off the FIELD, not off a step's committed answer. On the web
    // the two could disagree for a render and the balance was silently
    // dropped once; here the field is the only copy, which is the same
    // fix done structurally.
    checkInBalance: balanceAnswer(d.balance),
    // The paycheck is passed in so a contribution ticked "On my
    // payday" can take its cadence and next date — a copy made here,
    // once, not a live link. See ContributionRow in the engine.
    accounts: collectAccountsWith(
      d.accounts, d.contributions, today,
      setupPaycheck(d.payAmount, d.payCadence, today, d.payday),
    ),
  };
}

/**
 * Should a new account be met with the flow? — PHASE 3's question.
 *
 * Three conditions, and each one is there because of a way this gets
 * annoying rather than helpful:
 *
 *   - `hasSeenOnboarding` is ACCOUNT data, so somebody who did setup on
 *     the web is not asked again on the phone. That flag is the web's
 *     own gate and it means "completed or skipped", which is exactly
 *     the question here too.
 *   - `isNewAccount` is belt and braces for an account that predates
 *     the flag. Asking a two-year user to set up their budget would be
 *     worse than not asking a new one.
 *   - `dismissed` is per device and exists for the offline case: Skip
 *     writes `hasSeenOnboarding`, and a write that cannot land must not
 *     leave somebody stuck in a wizard they already closed. IT IS A
 *     FACT ABOUT ONE ACCOUNT ON ONE PHONE, and the caller is the half
 *     that has to know whose — see dismissedBy in lib/prefs.ts. It was
 *     a bare device boolean until 2026-10-17, which meant the first
 *     account to finish setup on a phone skipped it for every account
 *     after it. Two brand-new accounts on the owner's own phone got
 *     neither the flow nor the tour that follows it.
 *
 * Quitting the app mid-flow leaves all three unchanged, so the flow
 * comes back — correct, and the same as the web.
 */
export function shouldRunSetup(state: BudgetState, dismissed: boolean): boolean {
  if (dismissed) return false;
  if (state.settings?.hasSeenOnboarding) return false;
  return isNewAccount(state);
}

/**
 * Where the setup ScrollView has to sit for `field` to clear the keyboard.
 *
 * WHY THIS IS A FUNCTION rather than three lines in an onFocus handler.
 * The paycheck step's payday control sits below the fold the moment the
 * number pad is up, which is the whole reason it was reported: somebody
 * typed their pay, picked a frequency, went to tap the date and found
 * nothing there. A component can only be trusted to do this right if
 * the arithmetic can be checked without a device, and a device is
 * exactly what is not available here.
 *
 * `field` is in CONTENT coordinates (what measureLayout against the
 * scroll view's content gives); `view` is where the window currently
 * sits and how tall it is once the keyboard has taken its share.
 *
 * Returns the new offset, or null when the field is already clear —
 * null matters, because scrolling a field that is already visible
 * yanks the screen out from under somebody mid-type.
 */
export function scrollToReveal(
  field: { y: number; height: number },
  view: { offset: number; height: number },
  pad = 16,
): number | null {
  if (view.height <= 0) return null;
  const top = field.y - pad;
  const bottom = field.y + field.height + pad;
  // Above the window: put its top just inside, never past the start.
  if (top < view.offset) return Math.max(0, top);
  // Below it: lift by exactly as much as is hidden. A field taller than
  // the window still shows its top, which is where the label is.
  if (bottom > view.offset + view.height) {
    return Math.max(0, Math.min(top, bottom - view.height));
  }
  return null;
}
