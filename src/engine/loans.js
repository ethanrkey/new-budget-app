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
// progress.js's contributionsSince uses a strict `>`.)
import { buildAllEvents } from "./generate.js";

function round(n) { return Math.round(n * 100) / 100; }
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}
function sortedSnapshots(state, categoryId) {
  return [...(state.balanceSnapshots?.[categoryId] || [])].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? -1 : 1
  );
}

export function isLoanConfigured(cat) {
  return !!cat && cat.kind === "debt" && cat.originalPrincipal != null;
}

// Amortize from a known balance at `anchorDate` forward to `asOfISO`.
// `includeEnd` controls whether a payment dated exactly `asOfISO` counts:
// true for a live projection ("through today"), false for a history
// segment ending at the next snapshot (that snapshot is start-of-day, so
// a same-day payment belongs to the segment AFTER it). Interest also
// accrues on the trailing stretch after the last payment up to asOf —
// a debt keeps accruing whether or not a payment happened.
function amortizeFrom(state, cat, anchorAmount, anchorDate, asOfISO, includeEnd) {
  const apr = (cat.interestRate || 0) / 100;
  const accrualStart =
    cat.interestStartDate && cat.interestStartDate > anchorDate ? cat.interestStartDate : anchorDate;
  const payments = buildAllEvents(state, asOfISO).filter(
    (e) => e.category === cat.id && e.date >= anchorDate && (includeEnd ? e.date <= asOfISO : e.date < asOfISO)
  );
  const interestFor = (balance, fromDate, toDate) => {
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
export function computeLoanExpected(state, cat, asOfISO) {
  const snaps = sortedSnapshots(state, cat.id).filter((s) => s.date <= asOfISO);
  const anchor = snaps.length ? snaps[snaps.length - 1] : null;
  if (!anchor || !isLoanConfigured(cat)) return { anchor: null, expected: null };
  return { anchor, expected: amortizeFrom(state, cat, anchor.amount, anchor.date, asOfISO, true) };
}

// Every logged balance annotated with what the amortization expected AT
// THAT MOMENT (carried from the prior snapshot) — drives the dashed
// projected line. Recomputed from current transactions on every call,
// never stored. The first snapshot is the baseline and matches itself.
export function computeLoanHistory(state, cat) {
  const snaps = sortedSnapshots(state, cat.id);
  return snaps.map((snap, i) => {
    if (i === 0 || !isLoanConfigured(cat)) return { ...snap, expected: snap.amount, variance: 0 };
    const prior = snaps[i - 1];
    const expected = amortizeFrom(state, cat, prior.amount, prior.date, snap.date, false);
    return { ...snap, expected, variance: round(snap.amount - expected) };
  });
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
//    is measured from `bestOwed`, the LOWEST balance ever logged. Using the
//    low-water balance rather than today's is what makes the bar monotonic:
//    a month of interest with no payment can't walk it backwards, because
//    min-so-far can only fall. The trade the user chose deliberately: the
//    number then reflects the best you've got it down to, not owed ÷ peak
//    today. The branch is sticky (it keys off peak, not today's balance), so
//    crossing back under the original principal can't jump the bar backwards
//    by swapping denominators mid-payoff.
export function computeLoanProgress(state, cat, asOfISO) {
  if (!isLoanConfigured(cat)) return null;
  const snaps = sortedSnapshots(state, cat.id);
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  const { expected } = computeLoanExpected(state, cat, asOfISO);
  const original = cat.originalPrincipal;
  const outstanding = latest ? latest.amount : null;

  const amounts = snaps.map((s) => s.amount);
  const peak = Math.max(original, ...(amounts.length ? amounts : [original]));
  const bestOwed = amounts.length ? Math.min(...amounts) : null;
  const everAboveOriginal = peak > original;
  const basis = everAboveOriginal ? peak : original;

  let percentPaid = null;
  if (latest && basis > 0) {
    percentPaid = everAboveOriginal
      ? Math.min(100, Math.max(0, round((1 - bestOwed / peak) * 100)))
      : Math.min(100, Math.max(0, round((1 - outstanding / original) * 100)));
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
