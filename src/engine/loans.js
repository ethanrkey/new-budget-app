// ---- Debt amortization: expected remaining balance for a loan ----
// A "loan" is just a recurring item (its `category` is a debt-kind tracker
// category — see model.js) that also carries `interestRate` (APR %) and
// `originalPrincipal` ($). The payment schedule itself is the SAME recurring
// rule already used everywhere else (cadence/amount/startDate), so a loan
// respects any variable-bill actual override and paidOverride exactly like
// any other item, since it's built from the same event stream.
//
// A debt category's own "expected" is fundamentally different from an asset
// category's (engine/progress.js): an asset's expected is anchored off a
// logged balance PLUS contributions since (there's no other way to know
// what it should be — nothing else determines a savings balance). A debt's
// expected is instead fully self-contained — an amortization schedule
// computed straight from each loan's own rate/principal/payments, needing
// no snapshot to anchor it at all. Snapshots you log are compared AGAINST
// that schedule, not used to derive it.
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

// Simple-interest amortization: each payment reduces principal by (payment
// - interest accrued since the last payment), where interest accrues on the
// OUTSTANDING balance at the APR, prorated by elapsed days — works uniformly
// regardless of the payment's cadence (monthly, biweekly, ...). Never goes
// negative; a schedule that outpaces the real payoff just caps at 0. Returns
// null when the loan hasn't been configured yet (no originalPrincipal set).
export function computeLoanBalance(state, item, asOfISO) {
  if (item.originalPrincipal == null) return null;
  const apr = (item.interestRate || 0) / 100;
  // Interest accrues from the LATER of the payment start and an optional
  // interestStartDate (e.g. a student loan with no interest until Dec 2026:
  // payments before that reduce principal dollar-for-dollar). Absent, the
  // anchor is startDate and this is exactly the pre-existing behavior — no
  // configured loan's number moves by adding the field.
  const accrualStart =
    item.interestStartDate && item.interestStartDate > item.startDate ? item.interestStartDate : item.startDate;
  const events = buildAllEvents(state, asOfISO)
    .filter((e) => e.id.startsWith(item.id + "@") && e.date <= asOfISO)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  let balance = item.originalPrincipal;
  let lastDate = item.startDate;
  for (const e of events) {
    // Only the part of the gap that falls on/after accrualStart earns interest.
    const from = lastDate > accrualStart ? lastDate : accrualStart;
    const days = e.date > accrualStart ? Math.max(0, daysBetween(from, e.date)) : 0;
    const interest = balance * apr * (days / 365);
    balance = Math.max(0, round(balance + interest - e.amount));
    lastDate = e.date;
  }
  return balance;
}

// For a debt card: remaining, original, and percent paid off (0–100) — the
// motivating framing. Deliberately NOT "expected remaining vs. actual
// remaining"; that compares you to an ideal payoff and only ever scolds.
export function computeLoanProgress(state, item, asOfISO) {
  const remaining = computeLoanBalance(state, item, asOfISO);
  if (remaining == null) return null;
  const original = item.originalPrincipal;
  const percentPaid = original > 0 ? Math.min(100, Math.max(0, round((1 - remaining / original) * 100))) : 0;
  return { remaining, original, percentPaid };
}

// The "cumulative debt" figure for one category — sum of every configured
// loan's amortized balance. Loans in this category that haven't had their
// rate/original amount set yet are skipped (never assumed to be 0, which
// would understate real debt) — their names come back separately so the
// Dashboard can prompt for setup instead of silently omitting them.
export function computeDebtCategoryExpected(state, categoryId, asOfISO) {
  const items = state.recurring.filter((r) => r.category === categoryId);
  const configured = items.filter((r) => r.originalPrincipal != null);
  const unconfigured = items.filter((r) => r.originalPrincipal == null);
  const loans = configured.map((item) => ({ id: item.id, name: item.name, balance: computeLoanBalance(state, item, asOfISO) }));
  return {
    total: round(loans.reduce((sum, l) => sum + l.balance, 0)),
    loans,
    unconfigured: unconfigured.map((item) => ({ id: item.id, name: item.name })),
  };
}

// Debt equivalent of progress.js's computeCategoryProgress — same shape
// (latest/expectedNow) plus the per-loan breakdown, so the Dashboard can
// render either kind through a similar shell.
export function computeDebtCategoryProgress(state, categoryId, asOfISO) {
  const expected = computeDebtCategoryExpected(state, categoryId, asOfISO);
  const snaps = sortedSnapshots(state, categoryId);
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  return { latest, expectedNow: expected.total, loans: expected.loans, unconfigured: expected.unconfigured };
}

// Debt equivalent of computeCategoryHistory. Unlike the asset version, every
// snapshot (including the first) has a real "expected" to compare against —
// the amortization schedule needs no prior snapshot to anchor it, so there's
// no "first snapshot has nothing to compare to" special case here. EXCEPT
// when nothing in this category is configured yet (no loan has both a rate
// and an original amount) — there `total` is trivially 0, and a variance
// against that isn't a real number, it's noise. `expected`/`variance` come
// back null in that case so the UI shows "not set up yet" instead of a
// bogus "(expected $0.00, +$2,000.00)".
export function computeDebtCategoryHistory(state, categoryId) {
  const snaps = sortedSnapshots(state, categoryId);
  return snaps.map((snap) => {
    const debt = computeDebtCategoryExpected(state, categoryId, snap.date);
    if (debt.loans.length === 0) return { ...snap, expected: null, variance: null };
    return { ...snap, expected: debt.total, variance: round(snap.amount - debt.total) };
  });
}
