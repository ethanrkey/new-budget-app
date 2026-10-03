// ---- Reconcile the forecast against reality (the Dashboard tab) ----
// Two independent things live here:
// 1. Fund-balance progress: an "expected" figure for a savings/debt/
//    investment category, anchored the same way checkInBalance anchors the
//    whole ledger — the last actual balance you logged, plus every
//    transaction in that category since. Never a raw from-zero cumulative;
//    that would just be today's Ledger stepping, which answers a different
//    question ("how much have I moved since checkInDate reset"), not "what
//    should actually be in this account right now."
// 2. Variable-bill variance: expected = the rule's flat per-occurrence
//    estimate times however many times it actually fires that month (a
//    biweekly/weekly bill can land 2 or 3 times in a given month — same
//    "2 vs 3 paydays" reality already true for paychecks) vs. whatever real
//    total was logged in monthlyActuals.
import { occurrenceDates } from "./generate.ts";
import { primaryAccount } from "./model.ts";
import type {
  BalanceSnapshot, BudgetState, Contribution, ISODate, MonthKey, RecurringItem,
} from "./types.ts";

export interface MonthVariance {
  monthKey: MonthKey;
  occurrences: number;
  /** The rule's amount times how many times it fires that month. */
  expected: number;
  /** What was logged, or null when nothing has been. */
  actual: number | null;
  delta: number | null;
}

export interface LoggedContributions {
  entries: Contribution[];
  total: number;
  byYear: Record<string, number>;
  /** False when nothing was ever logged — distinct from a logged zero. */
  logged: boolean;
}

export interface NetPosition {
  net: number;
  cash: number;
  assets: number;
  debt: number;
  unloggedAssets: number;
  unloggedDebts: number;
}

function round(n: number): number { return Math.round(n * 100) / 100; }

// The last real day of `monthKey` ("YYYY-MM"), for bounding an occurrence
// scan to exactly one month.
function endOfMonth(monthKey: MonthKey): ISODate {
  const [y, m] = monthKey.split("-").map(Number);
  // A "YYYY-MM" key always yields two parts; see endOfMonthISO in model.ts.
  const d = new Date(y!, m!, 0); // day 0 of next month = last day of this one
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sortedSnapshots(state: BudgetState, categoryId: string): BalanceSnapshot[] {
  return [...(state.balanceSnapshots?.[categoryId] || [])].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? -1 : 1
  );
}

// An asset category's logged balance history, oldest -> newest. Just the
// balances you recorded: no "expected", no variance.
//
// This used to annotate every snapshot with what the last snapshot plus the
// contributions since it would predict, and the card drew that as a dashed
// projected line. It was removed deliberately (2026-09-18): for a cash
// account it's arithmetic the user can do in their head, and for anything
// market-exposed it conflates market movement with transactions that were
// never recorded — so a "variance" said nothing useful about either. The
// balance history itself already answers "is this growing the way I expect",
// and `computeLoggedContributions` is the honest companion stat.
//
// NOTE the deliberate asymmetry, which is now ENGINE-level only: loans still
// compute `expected` (engine/loans.ts) because amortization is real math about
// a known quantity — last logged balance + interest accrued − payments — not a
// guess about a market. The loan CARD no longer draws it as a chart (removed
// on the user's call, 2026-09-28); the history list still shows it and the
// harness still asserts it. Don't "tidy up" by stripping the loan math too.
export function computeCategoryHistory(state: BudgetState, categoryId: string): BalanceSnapshot[] {
  return sortedSnapshots(state, categoryId);
}

// One variable bill's expected-vs-actual for one month. `expected` is the
// rule's flat per-occurrence estimate times however many times it actually
// fires in that specific month — not always 1, now that variable bills can
// be any cadence, not just monthly.
export function computeMonthVariance(item: RecurringItem, monthlyActuals: BudgetState["monthlyActuals"] | undefined, monthKey: MonthKey): MonthVariance {
  const occurrences = occurrenceDates(item, endOfMonth(monthKey)).filter((d) => d.slice(0, 7) === monthKey).length;
  const expected = round(item.amount * occurrences);
  const actual = monthlyActuals?.[item.id]?.[monthKey];
  return {
    monthKey,
    occurrences,
    expected,
    actual: actual ?? null,
    delta: actual != null ? round(actual - expected) : null,
  };
}

// What you ACTUALLY put in, from the contribution log — never from the ledger.
// Summing tagged ledger transactions (which is what this used to do) counts
// PLANNED contributions and calls them contributed: a forecast wearing the
// label of a fact, the same error as the projected line that was removed from
// these cards. A contribution counts only once you've logged it.
//
// `entries` comes back oldest -> newest for the editable history list, and
// `byYear` newest year first for the stat. `total` is all of it. An account
// you never log (a 401k deducted before the paycheck, say) reports
// `logged: false` so the card can say "not tracked" instead of "$0.00" —
// zero-because-unrecorded and zero-because-you-contributed-nothing are
// different claims and must not look alike.
//
// Entries carry `source` ("manual" today; an importer writes its own), so
// Plaid-imported contributions land in this same list and everything here
// keeps working unchanged.
export function computeLoggedContributions(state: BudgetState, categoryId: string, asOfISO?: ISODate): LoggedContributions {
  const all = [...(state.contributionLog?.[categoryId] || [])].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? -1 : 1
  );
  const entries = asOfISO ? all.filter((c) => c.date <= asOfISO) : all;

  const byYear: Record<string, number> = {};
  let total = 0;
  for (const c of entries) {
    const y = c.date.slice(0, 4);
    byYear[y] = round((byYear[y] || 0) + c.amount);
    total = round(total + c.amount);
  }
  return {
    entries,
    total,
    byYear: Object.fromEntries(Object.entries(byYear).sort((a, b) => (a[0] < b[0] ? 1 : -1))),
    logged: all.length > 0,
  };
}


// The Dashboard hero: overall net position, built ONLY from reality-layer
// numbers — the verified checking balance (never the projected ledger
// balance; the Ledger owns projection) plus each asset category's last
// LOGGED balance, minus each debt category's last logged balance (falling
// back to the amortized total when configured loans exist but nothing's
// been logged). A category with nothing to go on contributes 0 and is
// COUNTED, so the UI can say "N not yet logged" instead of letting a low
// number masquerade as the truth.
export function computeNetPosition(state: BudgetState): NetPosition {
  const cash = round(Number(primaryAccount(state).balance) || 0);
  let assets = 0, debt = 0, unloggedAssets = 0, unloggedDebts = 0;
  for (const cat of state.trackerCategories || []) {
    const snaps = sortedSnapshots(state, cat.id);
    const latest = snaps.length ? snaps[snaps.length - 1] : null;
    if (cat.kind === "debt") {
      // A loan's outstanding balance is its last LOGGED snapshot — the
      // truth, same as an asset. No snapshot means no anchor at all (the
      // loan model never invents one from origination), so it's counted
      // as unlogged rather than contributing a number the user never saw.
      if (latest) debt += latest.amount;
      else unloggedDebts++;
    } else if (latest) {
      assets += latest.amount;
    } else {
      unloggedAssets++;
    }
  }
  return {
    net: round(cash + assets - debt),
    cash,
    assets: round(assets),
    debt: round(debt),
    unloggedAssets,
    unloggedDebts,
  };
}

// The last `count` months as "YYYY-MM" keys, ending at (and including)
// `anchorISO`'s month — the window the Spending tab's variable-spending
// table shows for each flagged bill.
/**
 * The months this rule was actually ACTIVE in, within the window — plus
 * any month that already carries a logged actual, so entered data is
 * never hidden.
 *
 * A month before the rule's startDate has zero occurrences and therefore
 * an expected of $0.00, and a row of $0.00 can never say anything: half
 * an Electric table was months that could not carry information. Worse,
 * a logged actual against a zero expectation renders as "+$150.00",
 * which reads as overspending when the truth is that nothing was due.
 */
export function activeMonthKeys(
  item: RecurringItem,
  monthlyActuals: BudgetState["monthlyActuals"] | undefined,
  months: MonthKey[]
): MonthKey[] {
  return months.filter((mk) => {
    const active = occurrenceDates(item, endOfMonth(mk)).some((d) => d.slice(0, 7) === mk);
    // An actual logged for an inactive month is kept deliberately: it is
    // data the user entered, and hiding it would be the silent drop this
    // codebase keeps having to fix. The row says the rule was not active
    // instead of pricing it as a variance.
    return active || monthlyActuals?.[item.id]?.[mk] != null;
  });
}

/**
 * Has this item proved it does not vary? An OBSERVATION about what
 * happened, not a warning about what might: a fixed $150 payment flagged
 * "track actual vs budgeted" has nothing to measure, and the honest
 * moment to say so is after the data says so — which also catches the
 * bill that genuinely was variable and has become fixed.
 *
 * Needs at least `minMonths` logged months, every one matching its
 * expectation exactly. Returns null when there is not enough evidence,
 * which is the common case and must stay silent.
 */
export function fixedSoFar(
  item: RecurringItem,
  monthlyActuals: BudgetState["monthlyActuals"] | undefined,
  months: MonthKey[],
  minMonths = 3
): { months: number; amount: number } | null {
  const logged = months
    .map((mk) => computeMonthVariance(item, monthlyActuals, mk))
    .filter((v) => v.actual != null && v.occurrences > 0);
  if (logged.length < minMonths) return null;
  if (!logged.every((v) => v.delta === 0)) return null;
  return { months: logged.length, amount: logged[0]!.actual! };
}

export function lastMonthKeys(anchorISO: ISODate, count: number): MonthKey[] {
  const [y, m] = anchorISO.slice(0, 7).split("-").map(Number);
  const out: MonthKey[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y!, m! - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
