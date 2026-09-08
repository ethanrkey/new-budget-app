// ---- Turn recurring rules into concrete dated events ----
import { CATEGORIES } from "./model.js";

function iso(d) { return d.toISOString().slice(0, 10); }
function parse(isoStr) { return new Date(isoStr + "T00:00:00"); }

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

  // 1) expand each recurring rule
  for (const rule of state.recurring) {
    const start = parse(rule.startDate);
    const end = rule.endDate ? parse(rule.endDate) : horizon;
    const stop = end < horizon ? end : horizon;

    let d = new Date(start);
    let guard = 0;
    while (d <= stop && guard < 2000) {
      guard++;
      events.push(makeEvent(rule, iso(d), paidOverrides, monthlyActuals));
      d = advance(d, rule);
    }
  }

  // 2) add one-offs within horizon
  for (const o of state.oneoffs) {
    if (parse(o.date) <= horizon) {
      events.push(makeEvent(o, o.date, paidOverrides, monthlyActuals));
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
// `monthlyActuals` is `{ [itemId]: { "YYYY-MM": amount } }` — the real amount
// for a variable bill (electric, groceries: the estimate is never exact) in a
// given month, logged from the Dashboard, independent of any specific dated
// instance. Once logged, it REPLACES the rule's flat estimate for every event
// that month (there's normally just one, since this only applies to monthly-
// cadence bills — see EventForm's `variable` toggle) so forward projections
// compound off the real number instead of a stale guess the moment it's known.
function makeEvent(src, date, paidOverrides, monthlyActuals) {
  const dir = CATEGORIES[src.category]?.direction ?? "out";
  const monthKey = date.slice(0, 7);
  const paidOverride =
    src.category === "bill" && (paidOverrides?.[monthKey]?.includes(src.id) ?? false);
  const actual = monthlyActuals?.[src.id]?.[monthKey];
  const amount = actual != null ? Math.abs(actual) : Math.abs(src.amount);
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