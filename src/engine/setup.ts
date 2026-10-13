import { todayISO, toISODate, uid, primaryAccount } from "./model.ts";
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

/**
 * Setup has been completed OR skipped — the flag both clients gate on.
 *
 * It lives in `settings`, which means it is account data and syncs, and
 * that is the behavior wanted: somebody who set up their budget on the
 * web must not be asked again the first time they open the phone.
 *
 * WIPE DATA CLEARS IT, and that is on purpose rather than by accident
 * — `wipeToNewAccount` is `blankState()` precisely so the flags that
 * make an account feel used do not survive a wipe. A wiped account is
 * greeted as a new one on both clients. The phone has a per-device
 * `setupDismissed` alongside this, so Settings clears that too; a
 * preference saying "I closed the wizard" must not outlive the data
 * it was closed over.
 */
export function markSetupSeen(state: BudgetState): BudgetState {
  return { ...state, settings: { ...state.settings, hasSeenOnboarding: true } };
}

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

// =====================================================================
// WHAT THE WIZARD'S ANSWERS MEAN — the other half of the shared
// definition, added 2026-10-13 when the phone's flow was built.
//
// `applySetup` above is what setup CREATES. Everything below is how a
// typed answer becomes the thing applySetup is given: which strings
// count as an answer at all, what rule each step builds, and which
// account rows are finished enough to keep.
//
// This is not decoration. Every one of these functions encodes a
// judgment that a second implementation would have had to guess at —
// that a blank field is a skipped question rather than a zero, that a
// negative paycheck is not a paycheck, that a row with an amount and
// no name must block the Finish button instead of being dropped. The
// last one is not hypothetical: it is what happened to a real user,
// and the fix lives here now so it can only be fixed once.
//
// Each builder returns `null` for "nothing to add", so a client's
// Continue and its Skip differ by exactly one line: Continue appends
// what the builder returned, Skip appends nothing. That is what keeps
// "Skip discards what was typed" true on both clients without either
// of them having to remember it.

export type SetupCadence = "weekly" | "biweekly" | "monthly";

/** One row of the "other monthly bills" step, as typed. */
export type BillRow = { name: string; amount: string; day: string };

/** One row of the accounts step, as typed. */
export type AccountRow = { name: string; amount: string };

export type SetupGroup = SetupAccount["group"];

/** The accounts step's three groups, each a list of typed rows. */
export type AccountRows = Record<SetupGroup, AccountRow[]>;

/** The day of the month `iso` falls on. */
const dayOf = (iso: ISODate): number => Number(iso.slice(8, 10));

/** A typed amount that is a real, positive number — or null. */
function positive(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

const clampDay = (raw: string, fallback: number) =>
  Math.min(31, Math.max(1, Number(raw) || fallback));

// THE `as BudgetItem` CASTS BELOW ARE LOAD-BEARING, not laziness.
// `order` is required on the type and is deliberately NOT set here:
// `upsertItem` assigns it from the state the rule is being inserted
// into, which is the only place that knows what the next one is.
// Inventing a number here would make two rules fight over position 0.

/** The paycheck step. Null when nothing usable was typed. */
export function paycheckRule(
  amount: string, cadence: SetupCadence, today: ISODate = todayISO(),
): BudgetItem | null {
  const amt = positive(amount);
  if (amt == null) return null;
  return {
    id: uid(), name: "Paycheck", amount: amt, category: "income",
    cadence, startDate: today, dayOfMonth: dayOf(today),
  } as BudgetItem;
}

/**
 * The rent step. Null when nothing usable was typed.
 *
 * Rent gets a day field of its own, unlike the generic bills, because
 * the 1st is usually right and because the ledger's ORDERING turns on
 * it — a bill dated wrong moves the running balance it is subtracted
 * from. The start date lands in the current month with the day clamped
 * to that month's length, so asking for the 31st in a 30-day month
 * produces a real date rather than a rollover into the next one.
 */
export function rentRule(
  amount: string, day: string, today: ISODate = todayISO(),
): BudgetItem | null {
  const amt = positive(amount);
  if (amt == null) return null;
  const dom = clampDay(day, 1);
  const d = new Date(today + "T00:00:00");
  const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dom, lastOfMonth));
  return {
    id: uid(), name: "Rent", amount: amt, category: "bill",
    cadence: "monthly", startDate: toISODate(d), dayOfMonth: dom,
  } as BudgetItem;
}

/**
 * The other-bills step. Rows with no name or no amount are dropped.
 *
 * A date box per row doubles this step's width on a phone and is where
 * people stop, so the due day DEFAULTS to today and is shown rather
 * than asked for. Shown, though — never guessed silently.
 */
export function billRules(rows: BillRow[], today: ISODate = todayISO()): BudgetItem[] {
  const out: BudgetItem[] = [];
  for (const b of rows) {
    const amt = positive(b.amount);
    if (!b.name.trim() || amt == null) continue;
    out.push({
      id: uid(), name: b.name.trim(), amount: amt, category: "bill",
      cadence: "monthly", startDate: today, dayOfMonth: clampDay(b.day, dayOf(today)),
    } as BudgetItem);
  }
  return out;
}

/** The groceries step. Null when nothing usable was typed. */
export function groceryRule(
  amount: string, cadence: SetupCadence, today: ISODate = todayISO(),
): BudgetItem | null {
  const amt = positive(amount);
  if (amt == null) return null;
  return {
    id: uid(), name: "Groceries", amount: amt, category: "bill",
    cadence, startDate: today, dayOfMonth: dayOf(today),
  } as BudgetItem;
}

/**
 * The balance step's answer, or null.
 *
 * ZERO IS A REAL ANSWER and an empty field is not, which is why this
 * cannot be `positive()`. Someone whose checking account is empty has
 * told us something true; someone who typed nothing has not. The whole
 * forecast is counted forward from this number, and a new user's first
 * ledger once projected from zero because the two cases were conflated.
 */
export function balanceAnswer(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/** Three empty groups, each with one empty row. */
export function blankAccountRows(): AccountRows {
  return { savings: [{ name: "", amount: "" }], investment: [{ name: "", amount: "" }], debt: [{ name: "", amount: "" }] };
}

type StartedRow = { group: SetupGroup; index: number; name: string; amount: number | null };

/**
 * Every row somebody has STARTED — either field filled in.
 *
 * The first version filtered on a non-empty name, so a row with an
 * amount and no name was silently discarded. That is exactly what
 * happened to a real user, because the name box had no label and they
 * reasonably assumed the section heading named the row. Both fields
 * are labeled now and a half-filled row is reported rather than
 * dropped.
 */
export function startedAccountRows(rows: AccountRows): StartedRow[] {
  const out: StartedRow[] = [];
  for (const group of ["savings", "investment", "debt"] as const) {
    (rows[group] ?? []).forEach((r, index) => {
      const amount = r.amount.trim() === "" ? null : Number(r.amount);
      if (r.name.trim() === "" && amount == null) return;
      out.push({ group, index, name: r.name.trim(), amount });
    });
  }
  return out;
}

/** Started rows that are not finished. Non-empty means Finish is blocked. */
export function incompleteAccountRows(rows: AccountRows): StartedRow[] {
  return startedAccountRows(rows).filter(
    (r) => r.name === "" || r.amount == null || Number.isNaN(r.amount)
  );
}

/** The finished rows, in the shape `applySetup` takes. */
export function collectAccounts(rows: AccountRows): SetupAccount[] {
  return startedAccountRows(rows)
    .filter((r) => r.name !== "" && r.amount != null && !Number.isNaN(r.amount))
    .map((r) => ({ name: r.name, amount: r.amount as number, group: r.group }));
}
