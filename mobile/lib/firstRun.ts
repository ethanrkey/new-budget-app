import type { BudgetState } from "../../src/engine/types.ts";

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
const isSeed = (s: { id: string; amount: number }) =>
  s.id.startsWith("seed-") && s.amount === 0;

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
export const FIRST_RUN_STEPS = [
  {
    key: "balance",
    title: "Log what's actually in checking",
    body: "Every projected balance is counted forward from this one number and the date you checked it.",
    cta: "Log balance",
  },
  {
    key: "income",
    title: "Add your paycheck",
    body: "A rule, not a one-off — \"every two weeks from Friday\" — so the forecast keeps going without you.",
    cta: "Add income",
  },
  {
    key: "bills",
    title: "Add a bill or two",
    body: "Rent, a subscription, whatever is predictable. You do not need all of them to see the shape.",
    cta: "Add a bill",
  },
] as const;
