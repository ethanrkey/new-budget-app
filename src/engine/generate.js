// ---- Turn recurring rules into concrete dated events ----
import { CATEGORIES } from "./model.js";

function iso(d) { return d.toISOString().slice(0, 10); }
function parse(isoStr) { return new Date(isoStr + "T00:00:00"); }

// Generate all events (recurring expanded + one-offs) up to `horizonISO`.
export function buildEvents(state, horizonISO) {
  const events = [];
  const horizon = parse(horizonISO);

  // 1) expand each recurring rule
  for (const rule of state.recurring) {
    const start = parse(rule.startDate);
    const end = rule.endDate ? parse(rule.endDate) : horizon;
    const stop = end < horizon ? end : horizon;

    let d = new Date(start);
    let guard = 0;
    while (d <= stop && guard < 2000) {
      guard++;
      events.push(makeEvent(rule, iso(d)));
      d = advance(d, rule);
    }
  }

  // 2) add one-offs within horizon
  for (const o of state.oneoffs) {
    if (parse(o.date) <= horizon) {
      events.push(makeEvent(o, o.date));
    }
  }

  // 3) sort by date; income before expense on the same day
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (b.direction === "in") - (a.direction === "in");
  });

  return events;
}

function makeEvent(src, date) {
  const dir = CATEGORIES[src.category]?.direction ?? "out";
  return {
    id: src.id + "@" + date,
    name: src.name,
    amount: Math.abs(src.amount),
    direction: dir,
    category: src.category,
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