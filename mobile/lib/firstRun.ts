import type { BudgetState } from "../../src/engine/types.ts";
import { CATEGORIES } from "../../src/engine/model.ts";
// The same rule the engine anchors on. It was written twice — here and,
// from 2026-10-14, inside newestSnapshot, which has to know the same
// thing so a seed never outranks a logged reading. One definition.
import { isSeedSnapshot } from "../../src/engine/entities.ts";

// Has this account been used yet?
//
// WHY THIS QUESTION SUDDENLY MATTERS. Until Google sign-in landed on
// the phone, an account could only be born on the web, where the setup
// wizard is — so the phone never met a brand-new one. OAuth provisions
// a user on first sign-in, so now it does: a tester, or an App Review
// reviewer using Sign in with Apple, gets a fresh account ON THE PHONE
// and lands wherever the app happens to put them.
//
// Where it put them was the Ledger saying "Nothing projected in this
// window." — which is a true sentence about a window and a useless one
// about an empty account, and reads as a broken app rather than an
// empty one.
//
// WHAT A "NEW" ACCOUNT ACTUALLY CONTAINS, which is not nothing:
// `normalize()` seeds one checking account at $0 with a snapshot dated
// today, and three tracker categories (Savings, Investments, Debt). So
// emptiness cannot be tested by asking whether anything exists. It is
// tested by asking whether the USER has put anything in.

/**
 * A snapshot `normalize()` minted, as opposed to one somebody logged.
 *
 * The id is not enough on its own, and finding that out is the reason
 * this is a function with a comment. `updateAccountBalance` upserts BY
 * DATE: logging a balance on a date that already has a snapshot keeps
 * that snapshot's id and changes only the amount. The seed is dated
 * today, so the very first balance someone logs usually lands on top of
 * it and inherits `seed-checking`.
 *
 * So the amount has to be part of the test. A seed is a seed id AT
 * ZERO; anything else on that id is a person's number.
 *
 * The one case the data genuinely cannot separate is someone logging
 * exactly $0 on the seed's own date — and the behavior that falls out
 * is the right one anyway. An account with no rules and nothing in
 * checking has nothing to project, so the first-run screen is still
 * what it should be showing.
 */
const isSeed = isSeedSnapshot;

/**
 * True when nothing in this account came from a person.
 *
 * Deliberately NOT "the ledger is empty": a ledger can be empty because
 * the window is wrong, or because every rule ended last year, and both
 * of those want the old message and not a tutorial. The two states are
 * different sentences and conflating them was the original defect.
 */
export function isNewAccount(state: BudgetState): boolean {
  if ((state.recurring?.length ?? 0) > 0) return false;
  if ((state.oneoffs?.length ?? 0) > 0) return false;

  // A logged checking balance counts as use even with no rules yet —
  // it is the anchor, and someone who has set it has started.
  for (const list of Object.values(state.accountSnapshots ?? {})) {
    if (list.some((s) => !isSeed(s))) return false;
  }
  // So does a logged balance on any tracked category, or a contribution.
  for (const list of Object.values(state.balanceSnapshots ?? {})) {
    if (list.length > 0) return false;
  }
  for (const list of Object.values(state.contributionLog ?? {})) {
    if (list.length > 0) return false;
  }
  return true;
}

/**
 * Which of the three steps have actually been done.
 *
 * THIS REPLACED A SINGLE BOOLEAN, and the reason is a bug that reached
 * a phone. `isNewAccount` flips false on the FIRST write, so logging a
 * balance — step one — made the whole guide disappear and left a new
 * user on an empty Ledger with no sign that steps two and three
 * existed. The guide died at exactly the moment it had proved useful.
 *
 * A guide has to survive its own first success, so progress is per
 * step and the thing is shown until every step is done or it is
 * dismissed.
 */
export function firstRunProgress(state: BudgetState): Record<StepKey, boolean> {
  const items = [...(state.recurring ?? []), ...(state.oneoffs ?? [])];
  const directionOf = (c: string) => CATEGORIES[c]?.direction ?? "out";

  let balance = false;
  for (const list of Object.values(state.accountSnapshots ?? {})) {
    if (list.some((s) => !isSeed(s))) { balance = true; break; }
  }
  return {
    balance,
    income: items.some((i) => directionOf(i.category) === "in"),
    // Anything that leaves: a bill, a one-off, a transfer to savings.
    // Someone who has entered rent has done this step whatever they
    // called the category.
    bills: items.some((i) => directionOf(i.category) === "out"),
  };
}

/** How many steps are left. Zero means the guide has finished its job. */
export function stepsRemaining(state: BudgetState): number {
  const done = firstRunProgress(state);
  return FIRST_RUN_STEPS.filter((s) => !done[s.key]).length;
}

/**
 * Show the guide? Until the work is done, or until asked not to.
 *
 * Dismissal is per device and deliberately not account data: it is a
 * statement about this screen on this phone, not a fact about the
 * budget. Same rule as every other preference here.
 */
export function showFirstRun(state: BudgetState, dismissed: boolean): boolean {
  return !dismissed && stepsRemaining(state) > 0;
}

export type StepKey = "balance" | "income" | "bills";

/**
 * The three things a fresh account needs, in the order they make sense.
 *
 * The balance first, because it is the one number every projected row is
 * computed forward from and a forecast from an invented starting figure
 * is worse than no forecast. Income next, because a list of bills with
 * nothing coming in projects straight down and looks alarming for no
 * reason. Bills last.
 *
 * All three point at controls THAT ALREADY EXIST on the phone. Nothing
 * here is a second way to do anything — which is also the answer to App
 * Review's minimum-functionality question: the app does its whole job
 * on the device, and the only thing that was missing was saying so.
 */
export const FIRST_RUN_STEPS: readonly { key: StepKey; title: string; body: string; cta: string; done: string }[] = [
  {
    key: "balance",
    title: "Log what's actually in checking",
    body: "Every projected balance is counted forward from this one number and the date you checked it.",
    cta: "Log balance",
    done: "Balance logged",
  },
  {
    key: "income",
    title: "Add your paycheck",
    body: "A rule, not a one-off — \"every two weeks from Friday\" — so the forecast keeps going without you.",
    cta: "Add income",
    done: "Income added",
  },
  {
    key: "bills",
    title: "Add a bill or two",
    body: "Rent, a subscription, whatever is predictable. You do not need all of them to see the shape.",
    cta: "Add a bill",
    done: "Bills added",
  },
];
