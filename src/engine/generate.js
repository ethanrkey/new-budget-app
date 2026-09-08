// ---- Turn recurring rules into concrete dated events ----
import { CATEGORIES } from "./model.js";

function iso(d) { return d.toISOString().slice(0, 10); }
function parse(isoStr) { return new Date(isoStr + "T00:00:00"); }
function round(n) { return Math.round(n * 100) / 100; }

// Every date a recurring rule fires, from its own startDate up to
// `horizonISO` (respecting its own endDate). Exported so callers that need
// to know a rule's occurrences WITHOUT generating full events can reuse the
// exact same expansion logic — engine/progress.js's cadence-aware "expected"
// for a variable bill (a biweekly item can land 2 or 3 times in a given
// month, same "2 vs 3 paydays" thing that's already true for paychecks) and
// engine/loans.js's amortization schedule both do this.
export function occurrenceDates(rule, horizonISO) {
  const horizon = parse(horizonISO);
  const start = parse(rule.startDate);
  const end = rule.endDate ? parse(rule.endDate) : horizon;
  const stop = end < horizon ? end : horizon;

  const dates = [];
  let d = new Date(start);
  let guard = 0;
  while (d <= stop && guard < 2000) {
    guard++;
    dates.push(iso(d));
    d = advance(d, rule);
  }
  return dates;
}

// Generate EVERY event (recurring expanded + one-offs) up to `horizonISO`,
// with NO live-month filtering — unlike buildEvents below, this doesn't drop
// already-past events. buildEvents uses this and then filters; the fund-
// balance progress calculator (engine/progress.js) also needs this directly,
// since it specifically sums already-past transactions (everything since a
// balance snapshot's date) that buildEvents would otherwise throw away.
export function buildAllEvents(state, horizonISO) {
  const events = [];
  const horizon = parse(horizonISO);

  const paidOverrides = state.paidOverrides || {};
  const monthlyActuals = state.monthlyActuals || {};

  // 1) expand each recurring rule. A logged monthly actual is a TOTAL for
  //    the month, not a per-instance amount — so for a weekly/biweekly rule
  //    that fires more than once in that month (gas, groceries bought every
  //    couple weeks), split it evenly across however many instances
  //    actually land there, rather than assuming exactly one (which only
  //    monthly-cadence rules guarantee).
  for (const rule of state.recurring) {
    const dates = occurrenceDates(rule, horizonISO);
    const countByMonth = new Map();
    for (const dt of dates) {
      const mk = dt.slice(0, 7);
      countByMonth.set(mk, (countByMonth.get(mk) || 0) + 1);
    }
    for (const dt of dates) {
      const countInMonth = countByMonth.get(dt.slice(0, 7));
      events.push(makeEvent(rule, dt, paidOverrides, monthlyActuals, countInMonth));
    }
  }

  // 2) add one-offs within horizon
  for (const o of state.oneoffs) {
    if (parse(o.date) <= horizon) {
      events.push(makeEvent(o, o.date, paidOverrides, monthlyActuals, 1));
    }
  }

  // 3) sort by date; income before expense on the same day
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (b.direction === "in") - (a.direction === "in");
  });

  return events;
}

// Generate all events (recurring expanded + one-offs) up to `horizonISO`.
export function buildEvents(state, horizonISO) {
  const events = buildAllEvents(state, horizonISO);

  // drop anything strictly BEFORE the check-in date — it's already
  // reflected in checkInBalance, so counting it again would double it up.
  // (Same-day events are kept: a brand-new item defaults to today's date,
  // same as checkInDate, and must still show up.) This is also what makes
  // the "live month" convention work with no special-casing: once
  // already-past events are gone, take-home for the check-in month
  // naturally sums to just the paychecks not yet received, and a bill
  // already due earlier this month drops out of the totals on its own.
  const checkInDate = state.settings.checkInDate;
  return events.filter((e) => e.date >= checkInDate);
}

// `paidOverrides` is `{ "YYYY-MM": [itemId,...] }` — bills checked off as already
// paid for that month. The event still appears (so it stays visible), but its
// magnitude is zeroed so it stops moving the balance / budget totals again.
//
// `monthlyActuals` is `{ [itemId]: { "YYYY-MM": amount } }` — the real TOTAL
// for a variable bill (electric, groceries, gas: the estimate is never
// exact) in a given month, logged from the Dashboard, independent of any
// specific dated instance. Once logged, it REPLACES the rule's flat
// estimate — split evenly across `countInMonth` instances when the rule
// fires more than once that month — so forward projections compound off
// the real number instead of a stale guess the moment it's known.
function makeEvent(src, date, paidOverrides, monthlyActuals, countInMonth = 1) {
  const dir = CATEGORIES[src.category]?.direction ?? "out";
  const monthKey = date.slice(0, 7);
  const paidOverride =
    src.category === "bill" && (paidOverrides?.[monthKey]?.includes(src.id) ?? false);
  const actual = monthlyActuals?.[src.id]?.[monthKey];
  const amount = actual != null ? Math.abs(round(actual / countInMonth)) : Math.abs(src.amount);
  return {
    id: src.id + "@" + date,
    name: src.name,
    amount,
    direction: dir,
    category: src.category,
    color: src.color ?? null, // optional per-item palette-index override
    order: src.order,
    paidOverride,
    isActual: actual != null, // this event used a logged actual, not the estimate
    date,
  };
}

function advance(d, rule) {
  const next = new Date(d);
  switch (rule.cadence) {
    case "weekly":   next.setDate(next.getDate() + 7);  break;
    case "biweekly": next.setDate(next.getDate() + 14); break;
    case "yearly":   next.setFullYear(next.getFullYear() + 1); break;
    case "monthly":
    default:
      next.setMonth(next.getMonth() + 1);
      // keep the intended day-of-month if provided
      if (rule.dayOfMonth) {
        next.setDate(Math.min(rule.dayOfMonth, daysInMonth(next)));
      }
      break;
  }
  return next;
}

function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}