// ---- Loans: a debt-kind CATEGORY is the loan; payments are tagged transactions ----
// This mirrors exactly how asset categories work. A loan category carries
// its terms — `originalPrincipal`, `interestRate` (APR %), optional
// `interestStartDate` — and its OUTSTANDING BALANCE is a logged snapshot in
// balanceSnapshots[categoryId], same as Roth. A payment is any transaction
// (one-off or recurring, any number of them) whose `category` is the loan.
// Setting up a loan never requires a transaction; it exists whether or not
// you're currently paying on it.
//
// The amortization anchors to the LAST LOGGED BALANCE, not to origination:
//   expected(asOf) = last logged outstanding
//                  + interest accrued since (on the running balance, at APR,
//                    prorated by days, none before interestStartDate)
//                  − every payment tagged to the loan since
// That's the asset formula plus interest — and it self-corrects every time
// you log, instead of compounding real-world drift forward forever.
//
// Snapshot semantics for a loan are START-OF-DAY: a payment dated the same
// day as a logged balance still counts against it (a logged loan balance
// is "what I owed going into that day"). Concretely, payments in
// [anchor.date, asOf] apply to a live projection, and a history segment
// between two snapshots covers [prior.date, snap.date) so no payment is
// ever counted twice. (Assets use the opposite, end-of-day convention —
// a deposit that day is already in the logged balance — which is why
// progress.ts's contributionsSince uses a strict `>`.)
import { buildAllEvents } from "./generate.ts";
import type {
  BalanceSnapshot, BudgetState, DebtCategory, ISODate, PaletteIndex, TrackerCategory,
} from "./types.ts";

/** A logged balance annotated with what amortization expected at that moment. */
export interface LoanHistoryEntry extends BalanceSnapshot {
  expected: number;
  variance: number;
}

/** One row of the collapsed debt card's list. */
export interface DebtSummaryRow {
  id: string;
  name: string;
  /** null when nothing has been logged — never 0, which would understate. */
  outstanding: number | null;
  loggedOn: ISODate | null;
  configured: boolean;
}

export interface DebtSummary {
  total: number;
  loans: DebtSummaryRow[];
  count: number;
  unlogged: number;
}

export interface LoanProgress {
  latest: BalanceSnapshot | null;
  outstanding: number | null;
  original: number;
  /** The most this loan has ever been worth owing. */
  peak: number;
  /** The denominator the bar actually uses: peak, or the original. */
  basis: number;
  everAboveOriginal: boolean;
  /** Owed beyond borrowed, when there is any. */
  aboveOriginal: number | null;
  percentPaid: number | null;
  expectedNow: number | null;
  interestRate: number;
  interestStartDate: ISODate | null;
}

function round(n: number): number { return Math.round(n * 100) / 100; }
function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}
function sortedSnapshots(state: BudgetState, categoryId: string): BalanceSnapshot[] {
  return [...(state.balanceSnapshots?.[categoryId] || [])].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? -1 : 1
  );
}

export function isLoanConfigured(cat: TrackerCategory | null | undefined): cat is DebtCategory & { originalPrincipal: number } {
  return !!cat && cat.kind === "debt" && cat.originalPrincipal != null;
}

// Amortize from a known balance at `anchorDate` forward to `asOfISO`.
// `includeEnd` controls whether a payment dated exactly `asOfISO` counts:
// true for a live projection ("through today"), false for a history
// segment ending at the next snapshot (that snapshot is start-of-day, so
// a same-day payment belongs to the segment AFTER it). Interest also
// accrues on the trailing stretch after the last payment up to asOf —
// a debt keeps accruing whether or not a payment happened.
function amortizeFrom(state: BudgetState, cat: DebtCategory, anchorAmount: number, anchorDate: ISODate, asOfISO: ISODate, includeEnd: boolean): number {
  const apr = (cat.interestRate || 0) / 100;
  const accrualStart =
    cat.interestStartDate && cat.interestStartDate > anchorDate ? cat.interestStartDate : anchorDate;
  const payments = buildAllEvents(state, asOfISO).filter(
    (e) => e.category === cat.id && e.date >= anchorDate && (includeEnd ? e.date <= asOfISO : e.date < asOfISO)
  );
  const interestFor = (balance: number, fromDate: ISODate, toDate: ISODate) => {
    if (toDate <= accrualStart) return 0;
    const from = fromDate > accrualStart ? fromDate : accrualStart;
    return balance * apr * (Math.max(0, daysBetween(from, toDate)) / 365);
  };

  let balance = anchorAmount;
  let lastDate = anchorDate;
  for (const e of payments) {
    balance = Math.max(0, round(balance + interestFor(balance, lastDate, e.date) - e.amount));
    lastDate = e.date;
  }
  return round(balance + interestFor(balance, lastDate, asOfISO));
}

// Live projection: the last logged balance on/before asOf, carried forward.
// `expected` is null when nothing has ever been logged — there's no anchor,
// and inventing one from origination would be a number the user never saw.
export function computeLoanExpected(state: BudgetState, cat: TrackerCategory, asOfISO: ISODate): { anchor: BalanceSnapshot | null; expected: number | null } {
  const snaps = sortedSnapshots(state, cat.id).filter((s) => s.date <= asOfISO);
  const anchor = snaps.length ? snaps[snaps.length - 1]! : null;
  if (!anchor || !isLoanConfigured(cat)) return { anchor: null, expected: null };
  return { anchor, expected: amortizeFrom(state, cat, anchor.amount, anchor.date, asOfISO, true) };
}

// Every logged balance annotated with what the amortization expected AT
// THAT MOMENT (carried from the prior snapshot) — drives the dashed
// projected line. Recomputed from current transactions on every call,
// never stored. The first snapshot is the baseline and matches itself.
export function computeLoanHistory(state: BudgetState, cat: TrackerCategory): LoanHistoryEntry[] {
  const snaps = sortedSnapshots(state, cat.id);
  return snaps.map((snap, i) => {
    if (i === 0 || !isLoanConfigured(cat)) return { ...snap, expected: snap.amount, variance: 0 };
    const prior = snaps[i - 1];
    const expected = amortizeFrom(state, cat, prior!.amount, prior!.date, snap.date, false);
    return { ...snap, expected, variance: round(snap.amount - expected) };
  });
}

// Every loan at a glance, for the Dashboard's collapsed debt card: the total
// owed plus one compact row per debt category, in display order.
//
// `total` is deliberately computed the same way computeNetPosition does it —
// the sum of each loan's LAST LOGGED outstanding — so the collapsed card and
// the hero's "Debt" figure can never disagree. A loan with no logged balance
// contributes nothing and is counted in `unlogged` instead: the loan model
// never invents an anchor from origination, and showing $0 for "I haven't
// told you yet" would quietly understate what's owed.
export function computeDebtSummary(state: BudgetState): DebtSummary {
  const cats = (state.trackerCategories || [])
    .filter((c) => c.kind === "debt")
    .sort((a, b) => a.order - b.order);

  let total = 0;
  let unlogged = 0;
  const loans = cats.map((cat) => {
    const snaps = sortedSnapshots(state, cat.id);
    const latest = snaps.length ? snaps[snaps.length - 1]! : null;
    if (latest) total += latest.amount;
    else unlogged++;
    return {
      id: cat.id,
      name: cat.name,
      outstanding: latest ? latest.amount : null,
      loggedOn: latest ? latest.date : null,
      configured: isLoanConfigured(cat),
    };
  });

  return { total: round(total), loans, count: loans.length, unlogged };
}

// For a debt card. Every figure here comes from LOGGED balances (the truth),
// never the projection. Deliberately does not produce "expected remaining vs.
// actual remaining"; that compares you to an ideal payoff and only ever
// scolds.
//
// Two cases, because "paid off" against the ORIGINAL
// principal is meaningless once interest has pushed the balance above it —
// an unsubsidized loan you haven't started paying can owe more than you
// borrowed, and (1 − owed/original) goes negative there. That used to clamp
// silently to 0% beside an "of $2,000.00" label next to a $2,302.73 balance,
// which just reads as broken math.
//
//  - Never above principal: unchanged — (1 − owed/original).
//  - Ever above principal (`everAboveOriginal`): the denominator becomes
//    `peak`, the most this loan has ever been worth owing, and the numerator
//    is measured from `bestOwed`, the lowest balance logged SINCE the peak.
//    Using the low-water balance rather than today's is what makes the bar
//    monotonic: a month of interest with no payment can't walk it
//    backwards, because the minimum can only fall. The trade the user chose
//    deliberately: the number then reflects the best you've got it down to,
//    not owed ÷ peak today. The branch is sticky (it keys off peak, not
//    today's balance), so crossing back under the original principal can't
//    jump the bar backwards by swapping denominators mid-payoff.
//
//    SINCE THE PEAK, not all-time, fixed 2026-10-19. `bestOwed` was the
//    minimum of every snapshot ever, and the peak was the maximum of
//    them — so logging a balance ABOVE the old peak grew the
//    denominator while the numerator stayed where it was, and the bar
//    went UP while the debt did. Reported with real figures: peak
//    $2,302.73 against a best of $2,154.65 reads 6.43%, and logging
//    $2,400 took it to 10.22% for owing more than ever.
//
//    A new high-water mark is a new starting line. Measuring from the
//    LAST time the balance was at its peak makes that bar read 0% and
//    climb again from there, which is the only honest answer: nothing
//    has been paid off relative to the most this has ever been worth.
//    Monotonicity is untouched below the peak, which is what it was
//    for.
export function computeLoanProgress(state: BudgetState, cat: TrackerCategory, asOfISO: ISODate): LoanProgress | null {
  if (!isLoanConfigured(cat)) return null;
  const snaps = sortedSnapshots(state, cat.id);
  const latest = snaps.length ? snaps[snaps.length - 1]! : null;
  const { expected } = computeLoanExpected(state, cat, asOfISO);
  const original = cat.originalPrincipal;
  const outstanding = latest ? latest.amount : null;

  const amounts = snaps.map((s) => s.amount);
  const peak = Math.max(original, ...(amounts.length ? amounts : [original]));
  // From the LAST snapshot that hit the peak — re-reaching an old high is
  // as much a reset as setting a new one, and taking the first occurrence
  // would let a dip from years ago go on crediting a balance that has
  // since climbed all the way back.
  // -1 when the peak IS the original principal and no snapshot reached
  // it — in which case everAboveOriginal is false and nothing below
  // reads bestOwed.
  const peakAt = amounts.lastIndexOf(peak);
  const bestOwed = peakAt < 0 ? null : Math.min(...amounts.slice(peakAt));
  const everAboveOriginal = peak > original;
  const basis = everAboveOriginal ? peak : original;

  let percentPaid = null;
  if (latest && basis > 0) {
    percentPaid = everAboveOriginal
      ? Math.min(100, Math.max(0, round((1 - bestOwed! / peak) * 100)))
      : Math.min(100, Math.max(0, round((1 - outstanding! / original) * 100)));
  }

  return {
    latest,
    outstanding,
    original,
    peak,
    basis,
    everAboveOriginal,
    // What's owed beyond what was borrowed, when there is any. Interest is
    // the only thing that can put it there, so that's what the card calls it
    // — strictly it's interest NET of anything already paid, since payments
    // made before the earliest logged balance aren't knowable.
    aboveOriginal: outstanding != null && outstanding > original ? round(outstanding - original) : null,
    percentPaid,
    expectedNow: expected,
    interestRate: cat.interestRate ?? 0,
    interestStartDate: cat.interestStartDate ?? null,
  };
}
