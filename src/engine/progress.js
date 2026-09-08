// ---- Reconcile the forecast against reality (the Dashboard tab) ----
// Two independent things live here:
// 1. Fund-balance progress: an "expected" figure for a savings/debt/
//    investment category, anchored the same way checkInBalance anchors the
//    whole ledger — the last actual balance you logged, plus every
//    transaction in that category since. Never a raw from-zero cumulative;
//    that would just be today's Ledger stepping, which answers a different
//    question ("how much have I moved since checkInDate reset"), not "what
//    should actually be in this account right now."
// 2. Variable-bill variance: a flat expected amount (the rule's own
//    estimate) vs. whatever real total was logged in monthlyActuals for a
//    given month — no transaction summation needed, since the estimate IS a
//    single number per month by construction.
import { buildAllEvents } from "./generate.js";

function round(n) { return Math.round(n * 100) / 100; }

function sortedSnapshots(state, categoryId) {
  return [...(state.balanceSnapshots?.[categoryId] || [])].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? -1 : 1
  );
}

// Sum of a category's transactions strictly after `sinceDateOrNull` (or ALL
// of them, if null — the "no snapshot logged yet" case) through `asOfISO`
// inclusive. Deliberately uses buildAllEvents, not buildEvents — the live-
// month filter that drops already-past events exists for the Ledger/Budget's
// forward-looking display and would silently exclude most of what a balance
// reconciliation actually needs to sum (everything since a past snapshot).
function contributionsSince(state, categoryId, sinceDateOrNull, asOfISO) {
  const events = buildAllEvents(state, asOfISO);
  return round(
    events
      .filter((e) => e.category === categoryId && e.date <= asOfISO && (!sinceDateOrNull || e.date > sinceDateOrNull))
      .reduce((sum, e) => sum + e.amount, 0)
  );
}

// The live, ever-current figure for the Dashboard: the last balance you
// logged (if any) plus every contribution since, projected through
// `asOfISO` (normally settings.checkInDate — the app's "now"). `latest` is
// null when nothing's ever been logged for this category, in which case
// `expectedNow` falls back to a from-zero cumulative (today's Ledger
// stepping behavior) since there's no real anchor yet.
export function computeCategoryProgress(state, categoryId, asOfISO) {
  const snaps = sortedSnapshots(state, categoryId);
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  const expectedNow = round((latest?.amount ?? 0) + contributionsSince(state, categoryId, latest?.date ?? null, asOfISO));
  return { latest, expectedNow };
}

// The full snapshot history for one category (oldest -> newest), each
// annotated with what was expected AT THAT TIME (the prior snapshot plus
// contributions since it, or from-zero if it's the first-ever snapshot) and
// the resulting variance. Recomputed fresh from current transactions on
// every call, never stored on the snapshot itself — editing or deleting a
// past transaction should update history the next time it's shown, not
// leave a stale variance behind.
export function computeCategoryHistory(state, categoryId) {
  const snaps = sortedSnapshots(state, categoryId);
  return snaps.map((snap, i) => {
    if (i === 0) {
      // The very first snapshot establishes the baseline — nothing was
      // being reconciled before it, so a from-zero transaction sum isn't a
      // real "expected" (it'd just show whatever was in the account before
      // you ever started tracking as a misleading variance). It trivially
      // matches itself instead.
      return { ...snap, expected: snap.amount, variance: 0 };
    }
    const prior = snaps[i - 1];
    const expected = round(prior.amount + contributionsSince(state, categoryId, prior.date, snap.date));
    return { ...snap, expected, variance: round(snap.amount - expected) };
  });
}

// One variable bill's expected-vs-actual for one month. `expected` is
// always the rule's flat estimate — a variable bill has no per-month
// forecast beyond that single number.
export function computeMonthVariance(item, monthlyActuals, monthKey) {
  const actual = monthlyActuals?.[item.id]?.[monthKey];
  return {
    monthKey,
    expected: item.amount,
    actual: actual ?? null,
    delta: actual != null ? round(actual - item.amount) : null,
  };
}

// The last `count` months as "YYYY-MM" keys, ending at (and including)
// `anchorISO`'s month — the window the Dashboard's variable-spending table
// shows for each flagged bill.
export function lastMonthKeys(anchorISO, count) {
  const [y, m] = anchorISO.slice(0, 7).split("-").map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
