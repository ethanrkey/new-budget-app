// ---- Compute everything the UI shows, from events + starting balance ----
import { buildEvents } from "./generate.js";
import { CATEGORIES } from "./model.js";

// LEDGER: every event with a running TD balance + stepped cumulative trackers.
export function computeLedger(state, horizonISO) {
  const events = buildEvents(state, horizonISO);
  let bal = Number(state.settings.checkInBalance) || 0;
  // One running total per user-defined tracker category (id -> cumulative $).
  // Anything not in the fixed CATEGORIES is a tracker category by definition.
  const cum = {};
  for (const c of state.trackerCategories || []) cum[c.id] = 0;

  const rows = events.map((e) => {
    // a paid-override zeroes this event's effect on the balance, but it still
    // shows in the ledger (struck through) so the row stays visible
    const delta = e.paidOverride ? 0 : e.amount;
    bal += e.direction === "in" ? delta : -delta;

    // step the matching tracker column — the category IS the tracker
    let stepped = null;
    if (!CATEGORIES[e.category] && e.category in cum) {
      cum[e.category] += e.amount;
      stepped = { key: e.category, value: round(cum[e.category]) };
    }

    return {
      ...e,
      balance: round(bal),
      negative: bal < 0,
      stepped, // {key,value} only on rows that update a tracker, else null
    };
  });

  return { rows, endingBalance: round(bal) };
}

// Group rows by "Mon YYYY" for the ledger's month headers.
export function groupByMonth(rows) {
  const groups = [];
  let current = null;
  for (const r of rows) {
    const label = monthLabel(r.date);
    if (!current || current.label !== label) {
      current = { label, rows: [] };
      groups.push(current);
    }
    current.rows.push(r);
  }
  return groups;
}

// An income item counts as "take-home" (a paycheck) when its name matches this;
// anything else income is "other in" (money from Poppy, etc.).
const PAY_RE = /pay|salary|take.?home/i;

// BUDGET: monthly grid, spreadsheet-style with sections.
export function computeBudget(state, horizonISO) {
    const events = buildEvents(state, horizonISO);
    const months = monthsBetween(state.settings.checkInDate, horizonISO);

    const byMonth = {};
    for (const m of months) byMonth[m.key] = { items: {}, takeHome: 0, payCount: 0 };

    for (const e of events) {
      const key = e.date.slice(0, 7);
      if (!byMonth[key]) continue;
      const b = byMonth[key];
      // a paid-override drops this instance's contribution (already handled this month)
      const amount = e.paidOverride ? 0 : e.amount;
      const signed = e.direction === "in" ? amount : -amount;
      b.items[e.name] = {
        val: (b.items[e.name]?.val || 0) + signed,
        category: e.category,
        order: e.order,
      };
      // take-home is the SUM of every paycheck event landing in this month
      // (2 biweekly = 2x, a 3-payday month = 3x), independent of how they're named.
      if (e.category === "income" && PAY_RE.test(e.name)) {
        b.takeHome += e.amount;
        b.payCount += 1;
      }
    }

    // starting point chains from prior month's cumulative; first month = check-in balance
    let prevCumulative = Number(state.settings.checkInBalance) || 0;
    const startBalance = Number(state.settings.checkInBalance) || 0;

    const cols = months.map((m, idx) => {
      const b = byMonth[m.key];
      const takeHome = b.takeHome;
      // split the aggregated-by-name items into non-paycheck income vs expenses
      let otherIn = 0, out = 0;
      const incomeItems = {}, expenseItems = {};
      for (const [name, obj] of Object.entries(b.items)) {
        if (obj.category === "income") {
          if (!PAY_RE.test(name)) otherIn += obj.val;
          incomeItems[name] = { val: obj.val, order: obj.order };
        } else {
          out += -obj.val;
          expenseItems[name] = { val: -obj.val, category: obj.category, order: obj.order };
        }
      }

      const startingPoint = idx === 0 ? 0 : prevCumulative;
      const tdChecking = idx === 0 ? startBalance : 0;
      const totalIn = startingPoint + takeHome + otherIn + tdChecking;
      const net = takeHome + otherIn - out;      // monthly net (excl. starting point)
      const cumulative = startingPoint + net + tdChecking;
      prevCumulative = cumulative;
  
      return {
        key: m.key, label: m.label,
        startingPoint: round(startingPoint),
        takeHome: round(takeHome),
        payCount: b.payCount,
        otherIn, otherInItems: incomeItemsExceptPay(incomeItems),
        tdChecking: round(tdChecking),
        totalIn: round(totalIn),
        totalOut: round(out),
        net: round(net),
        cumulative: round(cumulative),
        expenseItems,
      };
    });
  
    return cols;
}
  
function incomeItemsExceptPay(incomeItems) {
    const out = {};
    for (const [name, obj] of Object.entries(incomeItems)) {
      if (!PAY_RE.test(name)) out[name] = obj;
    }
    return out;
}

// ---- helpers ----
function round(n) { return Math.round(n * 100) / 100; }

function monthLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function monthsBetween(startISO, endISO) {
  const out = [];
  const d = new Date(startISO.slice(0, 7) + "-01T00:00:00");
  const end = new Date(endISO.slice(0, 7) + "-01T00:00:00");
  let guard = 0;
  while (d <= end && guard < 240) {
    guard++;
    const key = d.toISOString().slice(0, 7);
    out.push({ key, label: d.toLocaleString("en-US", { month: "short", year: "numeric" }) });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}