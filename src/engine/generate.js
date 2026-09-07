// ---- Turn recurring rules into concrete dated events ----
import { CATEGORIES } from "./model.js";

function iso(d) { return d.toISOString().slice(0, 10); }
function parse(isoStr) { return new Date(isoStr + "T00:00:00"); }

// Generate all events (recurring expanded + one-offs) up to `horizonISO`.
export function buildEvents(state, horizonISO) {
  const events = [];
  const horizon = parse(horizonISO);

  const paidOverrides = state.paidOverrides || {};

  // 1) expand each recurring rule
  for (const rule of state.recurring) {
    const start = parse(rule.startDate);
    const end = rule.endDate ? parse(rule.endDate) : horizon;
    const stop = end < horizon ? end : horizon;

    let d = new Date(start);
    let guard = 0;
    while (d <= stop && guard < 2000) {
      guard++;
      events.push(makeEvent(rule, iso(d), paidOverrides));
      d = advance(d, rule);
    }
  }

  // 2) add one-offs within horizon
  for (const o of state.oneoffs) {
    if (parse(o.date) <= horizon) {
      events.push(makeEvent(o, o.date, paidOverrides));
    }
  }

  // 3) drop anything strictly BEFORE the check-in date — it's already
  //    reflected in checkInBalance, so counting it again would double it up.
  //    (Same-day events are kept: a brand-new item defaults to today's date,
  //    same as checkInDate, and must still show up.) This is also what makes
  //    the "live month" convention work with no special-casing: once
  //    already-past events are gone, take-home for the check-in month
  //    naturally sums to just the paychecks not yet received, and a bill
  //    already due earlier this month drops out of the totals on its own.
  const checkInDate = state.settings.checkInDate;
  const kept = events.filter((e) => e.date >= checkInDate);

  // 4) sort by date; income before expense on the same day
  kept.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (b.direction === "in") - (a.direction === "in");
  });

  return kept;
}

// `paidOverrides` is `{ "YYYY-MM": [itemId,...] }` — bills checked off as already
// paid for that month. The event still appears (so it stays visible), but its
// magnitude is zeroed so it stops moving the balance / budget totals again.
function makeEvent(src, date, paidOverrides) {
  const dir = CATEGORIES[src.category]?.direction ?? "out";
  const monthKey = date.slice(0, 7);
  const paidOverride =
    src.category === "bill" && (paidOverrides?.[monthKey]?.includes(src.id) ?? false);
  return {
    id: src.id + "@" + date,
    name: src.name,
    amount: Math.abs(src.amount),
    direction: dir,
    category: src.category,
    color: src.color ?? null, // optional per-item palette-index override
    order: src.order,
    paidOverride,
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