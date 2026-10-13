import { todayISO, primaryAccount } from "./model.ts";
import {
  upsertItem, updateAccountBalance, addCategory, addBalanceSnapshot,
  setupAsset, deleteCategory, countTaggedItems,
} from "./mutate.ts";
import type { BudgetState, BudgetItem, ISODate } from "./types.ts";

// WHAT SETUP CREATES — the one definition, for both clients.
//
// This was fifty lines inside `completeOnboarding` in App.jsx, which is
// a React component, which meant the phone could only match it by
// reimplementing it. Moved here 2026-10-12 so the mobile setup flow
// CALLS it instead: same function, same output, and "the two clients
// agree" is a fact about the code rather than a promise in a document.
//
// It is pure. `today` is a parameter rather than a call so the node
// harness can pin it, and nothing here touches React, storage or the
// network.
//
// THREE DECISIONS LIVE IN HERE and all three are easy to lose by
// reimplementing. Each is commented where it happens:
//
//   1. a row named like a seeded category REUSES it, but only when
//      nothing is logged against it;
//   2. debt is created with a balance and no terms;
//   3. unused seeded categories are cleaned up afterward.

/** One savings / investment / debt row from the last setup step. */
export type SetupAccount = {
  name: string;
  amount: number;
  /** `savings` and `investment` become assets; `debt` becomes a debt. */
  group: "savings" | "investment" | "debt";
};

export type SetupAnswers = {
  recurring?: BudgetItem[];
  oneoffs?: BudgetItem[];
  /** The verified checking balance. Null or unparseable means "not asked". */
  checkInBalance?: number | string | null;
  accounts?: SetupAccount[];
};

export function applySetup(
  state: BudgetState,
  { recurring = [], oneoffs = [], checkInBalance, accounts = [] }: SetupAnswers,
  today: ISODate = todayISO(),
): BudgetState {
  let next = state;
  for (const item of [...recurring, ...oneoffs]) next = upsertItem(next, item);

  if (checkInBalance != null && !Number.isNaN(Number(checkInBalance))) {
    next = updateAccountBalance(next, primaryAccount(next).id, Number(checkInBalance), today);
  }

  // Savings, investments and debt from the wizard's last step. Debt is
  // created WITHOUT terms on purpose — name and what you owe now is
  // enough for the category, the card and the net position, and asking
  // for principal, APR and a start date during setup is where someone
  // gives up. The card prompts for terms later, when there is
  // something to point at.
  for (const a of accounts) {
    // A brand-new account is SEEDED with categories called Savings,
    // Investments and Debt (defaultTrackerCategories). Without this, a
    // row called "Savings" makes a second one and the Dashboard shows
    // two, one of them permanently empty. Reuse an existing same-named
    // category when it has nothing logged against it — never one that
    // does, because that would be writing into somebody's real history
    // on a name collision.
    const existing = next.trackerCategories.find(
      (c) => c.name.trim().toLowerCase() === a.name.toLowerCase()
        && (next.balanceSnapshots?.[c.id] ?? []).length === 0
    );
    if (a.group === "debt") {
      let id = existing?.kind === "debt" ? existing.id : null;
      if (!id) {
        next = addCategory(next, a.name, "debt");
        id = next.trackerCategories[next.trackerCategories.length - 1]!.id;
      }
      next = addBalanceSnapshot(next, id, Math.abs(a.amount), today);
    } else {
      next = setupAsset(next, {
        categoryId: existing?.kind === "asset" ? existing.id : null,
        name: a.name, balance: a.amount, asOf: today, assetKind: a.group,
      });
    }
  }

  // The seeded defaults that were never used go. A brand-new account
  // gets Savings / Investments / Debt from defaultTrackerCategories as
  // a hint; once setup has actually ASKED about all three, an untouched
  // one is just clutter on the Dashboard — and worse, it looks like
  // something the wizard created, which is exactly how a real user read
  // it. Only ones with nothing logged and nothing tagged: never a
  // category carrying data.
  for (const c of [...next.trackerCategories]) {
    const seeded = ["savings", "investments", "debt"].includes(c.name.trim().toLowerCase());
    const empty = (next.balanceSnapshots?.[c.id] ?? []).length === 0
      && countTaggedItems(next, c.id) === 0
      && (next.contributionLog?.[c.id] ?? []).length === 0;
    if (seeded && empty) next = deleteCategory(next, c.id);
  }

  return next;
}
