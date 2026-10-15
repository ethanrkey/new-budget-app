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

/** One savings / investment / debt row from the accounts step. */
export type SetupAccount = {
  name: string;
  amount: number;
  /** `savings` and `investment` become assets; `debt` becomes a debt. */
  group: "savings" | "investment" | "debt";
  /**
   * What goes IN to it every month, if anything. Optional everywhere.
   *
   * It rides on the account rather than arriving as a separate list
   * because the rule it becomes needs the category's id, and that id
   * does not exist until applySetup has created the category. A
   * second list would have to be matched back up by name, which is
   * the one thing a name is not safe for.
   */
  contribution?: SetupContribution | null;
};

/** A recurring transfer or payment into one account. */
export type SetupContribution = {
  amount: number;
  cadence: SetupCadence;
  /**
   * The date of the FIRST one, for every cadence.
   *
   * It was a day of the month, and only for a monthly contribution;
   * weekly and biweekly ones silently started on the day setup was
   * run. Reported from a device on 2026-10-15: a $400 savings
   * transfer landed on 10/15, the same day the balance it is counted
   * forward from was logged — so the first transfer is inside the
   * balance AND projected on top of it. An unasked-for date is the
   * same mistake the paycheck step made and fixed; this is that fix
   * applied to the one step that still had it.
   */
  start: ISODate;
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
    let categoryId: string;
    if (a.group === "debt") {
      let id = existing?.kind === "debt" ? existing.id : null;
      if (!id) {
        next = addCategory(next, a.name, "debt");
        id = next.trackerCategories[next.trackerCategories.length - 1]!.id;
      }
      next = addBalanceSnapshot(next, id, Math.abs(a.amount), today);
      categoryId = id;
    } else {
      next = setupAsset(next, {
        categoryId: existing?.kind === "asset" ? existing.id : null,
        name: a.name, balance: a.amount, asOf: today, assetKind: a.group,
      });
      // setupAsset either reused the category it was handed or made a
      // new one at the end of the list — the same two cases the debt
      // branch spells out, and the only way to learn the id in the
      // second one is to look.
      categoryId = existing?.kind === "asset"
        ? existing.id
        : next.trackerCategories[next.trackerCategories.length - 1]!.id;
    }

    // WHAT GOES IN, if the contributions step was answered for this
    // one. Built here rather than alongside the other rules because
    // the category it points at was created two lines ago.
    const rule = contributionRule(a, categoryId, today);
    if (rule) next = upsertItem(next, rule);
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

/**
 * A day of the month, forced into 1..31. THE BACKSTOP, not the guard.
 *
 * Both clients draw a 1-31 picker since build 9, so nothing they can
 * produce needs clamping — which is exactly why this stays and is
 * tested. The engine is called by the CSV importers, by the phone and
 * by the web, and "the UI cannot send a bad one" is a property of
 * three callers rather than of this function. Build 8 let somebody
 * type 50 into a number box; it arrived here and became 31 with
 * nothing said, and the lesson was about the control, not about the
 * clamp.
 *
 *   "50" -> 31, "40" -> 31      above the range, pulled down
 *   "0", "" , "abc" -> fallback  not a day at all
 *   "-3" -> 1                    below the range, pulled up
 *   "31" -> 31                   kept; a short month is handled where
 *                                the date is BUILT, by firstMonthlyOn
 *                                and by occurrenceDates, both of which
 *                                clamp to the month's own length
 *
 * `Number(raw) || fallback` catches NaN and 0 in one step, and 0 is
 * not a loss: there is no zeroth of the month.
 */
export const clampDay = (raw: string, fallback: number) =>
  Math.min(31, Math.max(1, Number(raw) || fallback));

/**
 * The first date a monthly rule due on `dom` should actually charge.
 *
 * THE BUG THIS EXISTS FOR, found on a device and on a fresh web
 * account the same day (2026-10-15). `occurrenceDates` emits a rule's
 * `startDate` VERBATIM as the first occurrence and only applies
 * `dayOfMonth` from the second one onward. `billRules` was setting
 * `startDate: today`, so every bill entered during setup charged on
 * the day setup was run and only found its real day the month after.
 *
 * Entering Spotify (due 10th), HBO (14th) and Gym (20th) on October
 * 14th put all three on October 14th. Spotify was then counted twice —
 * its real October charge is already inside the balance setup just
 * asked for — and Gym was simply on the wrong day.
 *
 * So the first occurrence is the next time that day of the month comes
 * around, today included. A bill due the 10th entered on the 14th
 * starts in November; one due the 20th starts this month.
 *
 * MONTH-END CLAMPS DOWN, never over: "the 31st" in a 30-day month is
 * the 30th, not the 1st of the next one. A rule keeps `dayOfMonth: 31`
 * either way, so the long months still charge on the 31st — the clamp
 * is about where it LANDS, not about what it means.
 */
export function firstMonthlyOn(dom: number, today: ISODate): ISODate {
  const t = new Date(today + "T00:00:00");
  for (const monthsAhead of [0, 1]) {
    const d = new Date(t.getFullYear(), t.getMonth() + monthsAhead, 1);
    d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    if (toISODate(d) >= today) return toISODate(d);
  }
  // Unreachable: next month's clamped day is always after today.
  return today;
}

// THE `as BudgetItem` CASTS BELOW ARE LOAD-BEARING, not laziness.
// `order` is required on the type and is deliberately NOT set here:
// `upsertItem` assigns it from the state the rule is being inserted
// into, which is the only place that knows what the next one is.
// Inventing a number here would make two rules fight over position 0.

/**
 * A NEW bill row, blank except for the day — which is today's.
 *
 * THE BUG THIS EXISTS FOR (found on a device, 2026-10-15). The step's
 * own copy says the due day "defaults to today", and the first row's
 * did. Every row after it did not: the phone seeded "+ Add another
 * bill" from `bills[0].day`, so a second bill inherited whatever the
 * user had just typed into the first one. Set bill 1 to the 8th and
 * every later row offered the 8th; set it to the 4th and they offered
 * the 4th. Deterministic, invisible, and contradicting the sentence
 * directly above it.
 *
 * The web seeded from a module-level `new Date().getDate()` instead,
 * which is today only until the tab has been open past midnight — the
 * same promise broken a different way, and a second definition of a
 * thing that should have had one.
 *
 * So both clients make a row HERE, and `today` is a parameter so the
 * answer is computed when the row is created rather than when some
 * module was first evaluated.
 */
export function defaultBillDay(today: ISODate = todayISO()): string {
  return String(dayOf(today));
}

export function emptyBillRow(today: ISODate = todayISO()): BillRow {
  return { name: "", amount: "", day: defaultBillDay(today) };
}

/**
 * Drop a bill row, and never leave the step with nothing on it.
 *
 * Added 2026-10-15: "+ Add another bill" rows could not be removed on
 * the phone at all, and the web's ✕ was hidden whenever one row was
 * left — so the last row could be emptied by hand but not cleared.
 *
 * REMOVING THE LAST ONE LEAVES AN EMPTY ONE. A bills step showing no
 * rows has no way back to a row except the "+ Add another bill" link
 * below it, which reads as the wrong control for the first one; and a
 * blank row is what the step opens with anyway, so clearing the last
 * row and arriving fresh look the same. The alternative — hiding the
 * remove control at one row, which is what the web did — means the
 * user cannot clear a row they typed into without selecting the text
 * in two fields.
 *
 * Shared so the two clients cannot disagree about the edge case,
 * which is the only part of this with a decision in it.
 */
export function removeBillRow(
  rows: BillRow[], index: number, today: ISODate = todayISO(),
): BillRow[] {
  const left = rows.filter((_, i) => i !== index);
  return left.length ? left : [emptyBillRow(today)];
}

/**
 * The paycheck step. Null when nothing usable was typed.
 *
 * `payday` IS THE WHOLE REASON THIS TAKES A FOURTH ARGUMENT. Setup
 * used to assume the first paycheck was today, and a cadence makes
 * that assumption expensive: every later date is wrong by however far
 * off payday actually was. Worse in the other direction — someone paid
 * THIS MORNING has that money inside the balance setup just asked
 * for, so starting the rule today counts it twice and the forecast
 * runs a whole paycheck high from day one.
 *
 * A payday in the past is clamped to today rather than refused. The
 * forms do not offer one, but this function is the definition and a
 * rule that starts before the balance it is counted forward from is
 * never what anybody meant.
 */
export function paycheckRule(
  amount: string, cadence: SetupCadence, today: ISODate = todayISO(),
  payday: ISODate = today,
): BudgetItem | null {
  const amt = positive(amount);
  if (amt == null) return null;
  const start = payday >= today ? payday : today;
  return {
    id: uid(), name: "Paycheck", amount: amt, category: "income",
    cadence, startDate: start, dayOfMonth: dayOf(start),
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
  // RENT HAD A QUIETER VERSION OF THE SAME BUG. It clamped into the
  // CURRENT month unconditionally, so rent due on the 1st, entered on
  // the 14th, started on a date that had already passed. It looked
  // right because setup also sets the checking balance as of today and
  // `buildEvents` drops everything before the anchor — so the stray
  // occurrence was swallowed rather than fixed, and would have
  // reappeared the moment anyone back-dated their balance.
  return {
    id: uid(), name: "Rent", amount: amt, category: "bill",
    cadence: "monthly", startDate: firstMonthlyOn(dom, today), dayOfMonth: dom,
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
    const dom = clampDay(b.day, dayOf(today));
    out.push({
      id: uid(), name: b.name.trim(), amount: amt, category: "bill",
      cadence: "monthly", startDate: firstMonthlyOn(dom, today), dayOfMonth: dom,
    } as BudgetItem);
  }
  return out;
}

/**
 * The first date a rule that happens on `dow` should charge.
 *
 * The weekday twin of `firstMonthlyOn`, and it exists for the same
 * reason: `occurrenceDates` emits a rule's `startDate` verbatim as its
 * first occurrence, so a weekly rule starting today happens today
 * whatever day of the week today is. Groceries bought on Sunday were
 * entering the forecast on a Wednesday because that is when setup was
 * run.
 *
 * TODAY COUNTS. Somebody setting up on a Sunday and saying they shop
 * on Sundays means this Sunday, not next week — the same call
 * `firstMonthlyOn` makes about a due day that is today.
 *
 * `dow` is 0 = Sunday, matching `Date.getDay()`.
 */
export function firstWeekdayOn(dow: number, today: ISODate): ISODate {
  const t = new Date(today + "T00:00:00");
  const ahead = (((dow - t.getDay()) % 7) + 7) % 7;
  t.setDate(t.getDate() + ahead);
  return toISODate(t);
}

/**
 * The groceries step. Null when nothing usable was typed.
 *
 * `variable: true`, which is the flag the Ledger's own form offers as
 * "Track actual vs. budgeted". Groceries is the example the whole
 * feature exists for: the step asks for a rough estimate and says so,
 * and an estimate is precisely what wants comparing against what was
 * really spent. Without the flag the Spending tab has nothing to put
 * in its variance column for the one rule most likely to move, and
 * the forecast treats a guess with the same certainty as rent.
 *
 * `weekday` IS A DAY OF THE WEEK, not a date. Shopping is the one
 * thing in setup that genuinely happens on a Saturday rather than on
 * the 23rd, and starting the rule on the day setup happened to be run
 * put the whole series on the wrong day of the week for good. Sunday
 * is the default because it is the most common one and because a
 * step with nothing chosen is a step people skip.
 */
export function groceryRule(
  amount: string, cadence: SetupCadence, today: ISODate = todayISO(),
  weekday = 0,
): BudgetItem | null {
  const amt = positive(amount);
  if (amt == null) return null;
  const start = firstWeekdayOn(weekday, today);
  return {
    id: uid(), name: "Groceries", amount: amt, category: "bill",
    cadence, startDate: start, dayOfMonth: dayOf(start), variable: true,
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

/** One blank row. The shape in one place, so the two clients and the
 *  two functions below cannot disagree about what "empty" is. */
export function emptyAccountRow(): AccountRow {
  return { name: "", amount: "" };
}

/** Three empty groups, each with one empty row. */
export function blankAccountRows(): AccountRows {
  return { savings: [emptyAccountRow()], investment: [emptyAccountRow()], debt: [emptyAccountRow()] };
}

/**
 * Drop an account row, and never leave a group with nothing in it.
 *
 * Exactly `removeBillRow`'s rule, for exactly its reason — see the
 * note there — applied to the savings, investment and debt lists
 * after build 9's device pass found that those three could be added
 * to and never pruned. The bills step had the problem first and got
 * a swipe gesture for it, which was the wrong answer twice over: it
 * was hard to actuate on a real phone, and it left the accounts step
 * with no answer at all. Both lists have a visible remove control
 * now, and both go through a function here so the edge case has one
 * definition.
 */
export function removeAccountRow(rows: AccountRow[], index: number): AccountRow[] {
  const left = rows.filter((_, i) => i !== index);
  return left.length ? left : [emptyAccountRow()];
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

// =====================================================================
// SCHEDULING WHAT GOES IN — the step after the accounts step, and the
// same question the Dashboard asks after one account is added.
//
// WHY IT IS A STEP OF ITS OWN rather than two more boxes on the
// accounts step. The accounts step already shows three groups and up
// to a dozen fields; adding an amount, a frequency and a day to every
// row would roughly double it, and that step is already the one
// somebody quits on. It also asks a different KIND of question: the
// accounts step is "what do you have", this is "what are you doing
// about it", and the first is worth answering even if the second is
// skipped.
//
// EVERY PART OF IT IS OPTIONAL. A blank amount is a skipped row, not a
// zero, and the whole step is skippable like the four before it. It is
// not shown at all when no savings, investment or debt account was
// entered, because a step listing nothing is a step that makes the
// flow look longer than it is.

/** One row of the contributions step, as typed. */
export type ContributionRow = { amount: string; cadence: SetupCadence; start: ISODate };

/** Rows, keyed by the account row they belong to — see contributionTargets. */
export type ContributionRows = Record<string, ContributionRow>;

export function blankContributionRow(today: ISODate = todayISO()): ContributionRow {
  // Monthly, because a transfer to savings or a loan payment is
  // monthly far more often than it is anything else, and the first
  // one defaults to today — shown, though, which is the whole
  // difference from the version that assumed it.
  return { amount: "", cadence: "monthly", start: today };
}

/**
 * The accounts this step asks about, each with the key its row is
 * held under.
 *
 * KEYED BY GROUP AND POSITION, not by index into the finished list
 * and not by name. A phone flow has a Back button: edit the accounts
 * step, come forward again, and an index into the finished list has
 * silently moved every answer onto a different account. Names cannot
 * be used either — two accounts are allowed to share one.
 */
export function contributionTargets(rows: AccountRows): { key: string; account: SetupAccount }[] {
  return startedAccountRows(rows)
    .filter((r) => r.name !== "" && r.amount != null && !Number.isNaN(r.amount))
    .map((r) => ({
      key: `${r.group}:${r.index}`,
      account: { name: r.name, amount: r.amount as number, group: r.group },
    }));
}

/** What one typed row means. Null for "nothing was entered here". */
export function contributionOf(
  row: ContributionRow | undefined, today: ISODate = todayISO(),
): SetupContribution | null {
  if (!row) return null;
  const amt = positive(row.amount);
  if (amt == null) return null;
  return { amount: amt, cadence: row.cadence, start: row.start || today };
}

/** The finished account rows with their contributions attached. */
export function collectAccountsWith(
  rows: AccountRows, contributions: ContributionRows, today: ISODate = todayISO(),
): SetupAccount[] {
  return contributionTargets(rows).map(({ key, account }) => {
    const contribution = contributionOf(contributions[key], today);
    return contribution ? { ...account, contribution } : account;
  });
}

/**
 * What a contribution is CALLED in the Ledger.
 *
 * Generated rather than asked for: a sixth question per account is
 * exactly the kind of thing that makes a step feel like paperwork.
 *
 * NO "To " PREFIX, since 2026-10-15 — owner's call from the build 8
 * device pass. "To Everbank savings" reads as a sentence fragment in
 * a column of nouns, and the account name is already the whole
 * answer: the row sits in that account's own category, so the
 * direction is in the category rather than in the name. It also
 * stopped the name lining up with anything — the Budget's rows and
 * the Dashboard's cards say "Everbank savings" and the Ledger said
 * "To Everbank savings" for the same thing.
 *
 * DEBT KEEPS "payment", which is not an exception to that. It is not
 * a prefix and it is not a direction; it is what the thing is, and
 * it is what makes the row legible beside a month's other bills,
 * where the bare account name would read as the balance.
 */
export function contributionName(a: Pick<SetupAccount, "name" | "group">): string {
  return a.group === "debt" ? `${a.name} payment` : a.name;
}

/**
 * The recurring rule one account's contribution becomes, or null.
 *
 * `category` is the tracker category's OWN id, which is how this app
 * says "this money went into that account" — the same value the
 * Ledger's category chips set. It is an outflow by definition (see
 * CATEGORIES in model.ts) and the Budget prints it as money kept
 * rather than money gone.
 *
 * IT STARTS ON THE DATE THAT WAS ASKED FOR, whatever the cadence.
 * Until 2026-10-15 only a monthly one had a date of its own — the
 * next occurrence of a day of the month — and weekly and biweekly
 * ones started today, because the step did not ask. That is the same
 * assumption the paycheck step used to make and for the same cost:
 * every later date is wrong by however far off the real first one
 * was, and a transfer dated today is counted twice, since the money
 * is already inside the balance the previous step asked for.
 *
 * A date in the past is clamped to today, as `paycheckRule` does.
 * The forms do not offer one, but this is the definition, and a rule
 * that starts before the balance it is counted forward from is never
 * what anybody meant.
 */
export function contributionRule(
  a: SetupAccount, categoryId: string, today: ISODate = todayISO(),
): BudgetItem | null {
  const c = a.contribution;
  if (!c || c.amount <= 0) return null;
  const start = c.start >= today ? c.start : today;
  return {
    id: uid(), name: contributionName(a), amount: c.amount, category: categoryId,
    cadence: c.cadence, startDate: start, dayOfMonth: dayOf(start),
  } as BudgetItem;
}

/**
 * The setup group a tracker category corresponds to.
 *
 * The Dashboard asks the same question setup's contributions step
 * asks, one account at a time, after an account is added — and it has
 * a real category rather than a typed row. This is the one conversion
 * between the two, so "Ally" and "Car loan payment" come out the
 * same whichever door the account came in through.
 */
export function groupOfCategory(
  c: { kind: "asset" | "debt"; assetKind?: string | null },
): SetupGroup {
  if (c.kind === "debt") return "debt";
  return c.assetKind === "investment" ? "investment" : "savings";
}

/**
 * The rule a contribution row becomes for a category that already
 * exists. Null when the row is blank.
 *
 * The Dashboard's follow-up, and the only difference from setup's
 * version is that there is nothing to create first.
 */
export function contributionRuleFor(
  category: { id: string; name: string; kind: "asset" | "debt"; assetKind?: string | null },
  row: ContributionRow | undefined,
  today: ISODate = todayISO(),
): BudgetItem | null {
  const contribution = contributionOf(row, today);
  if (!contribution) return null;
  return contributionRule(
    { name: category.name, amount: 0, group: groupOfCategory(category), contribution },
    category.id, today,
  );
}
