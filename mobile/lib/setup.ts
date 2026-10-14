import type { BudgetItem, BudgetState } from "../../src/engine/types.ts";
import {
  paycheckRule, rentRule, billRules, groceryRule, balanceAnswer,
  blankAccountRows, incompleteAccountRows, collectAccounts,
  type SetupCadence, type BillRow, type AccountRows, type SetupAnswers,
} from "../../src/engine/setup.ts";
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
  payAmount: string;
  payCadence: SetupCadence;
  /** The NEXT payday, which setup used to assume was today. */
  payday: string;
  rentAmount: string;
  rentDay: string;
  bills: BillRow[];
  groceryAmount: string;
  groceryCadence: SetupCadence;
  balance: string;
  accounts: AccountRows;
};

/** The day of the month `iso` falls on, as a string for a text field. */
const dayOf = (iso: string) => String(Number(iso.slice(8, 10)));

export function blankSetupDraft(today: string): SetupDraft {
  return {
    payAmount: "", payCadence: "biweekly", payday: today,
    // The 1st, like the web: it is right more often than today is, and
    // the ledger's ordering turns on it.
    rentAmount: "", rentDay: "1",
    bills: [{ name: "", amount: "", day: dayOf(today) }],
    groceryAmount: "", groceryCadence: "weekly",
    balance: "",
    accounts: blankAccountRows(),
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
    case "paycheck": return one(paycheckRule(d.payAmount, d.payCadence, today, d.payday));
    case "rent": return one(rentRule(d.rentAmount, d.rentDay, today));
    case "bills": return billRules(d.bills, today);
    case "groceries": return one(groceryRule(d.groceryAmount, d.groceryCadence, today));
    // The balance is not a rule — it is the anchor, and it is read off
    // the draft at the end rather than accumulated, because it is the
    // one answer that can be changed by going back.
    case "balance": return [];
    case "accounts": return [];
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

/** Which started account rows are unfinished, by group and index. */
export function accountRowErrors(d: SetupDraft): Record<string, "name" | "amount"> {
  const out: Record<string, "name" | "amount"> = {};
  for (const r of incompleteAccountRows(d.accounts)) {
    out[`${r.group}:${r.index}`] = r.name === "" ? "name" : "amount";
  }
  return out;
}

/** The draft plus whatever Continue collected, in the shape applySetup takes. */
export function setupAnswers(collected: BudgetItem[], d: SetupDraft): SetupAnswers {
  return {
    recurring: collected,
    oneoffs: [],
    // Read off the FIELD, not off a step's committed answer. On the web
    // the two could disagree for a render and the balance was silently
    // dropped once; here the field is the only copy, which is the same
    // fix done structurally.
    checkInBalance: balanceAnswer(d.balance),
    accounts: collectAccounts(d.accounts),
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
 *     leave somebody stuck in a wizard they already closed.
 *
 * Quitting the app mid-flow leaves all three unchanged, so the flow
 * comes back — correct, and the same as the web.
 */
export function shouldRunSetup(state: BudgetState, dismissed: boolean): boolean {
  if (dismissed) return false;
  if (state.settings?.hasSeenOnboarding) return false;
  return isNewAccount(state);
}
