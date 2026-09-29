// ---- Compute everything the UI shows, from events + starting balance ----
import { buildEvents } from "./generate.ts";
import { CATEGORIES, endOfMonthISO, primaryAccount, toISODate } from "./model.ts";
import type {
  BudgetColumn, BudgetState, ISODate, Ledger, LedgerRow, MonthKey, SpendingMix, SpendingSlice,
} from "./types.ts";

// LEDGER: every event with a running TD balance + stepped cumulative trackers.
export function computeLedger(state: BudgetState, horizonISO: ISODate): Ledger {
  const events = buildEvents(state, horizonISO);
  let bal = Number(primaryAccount(state).balance) || 0;
  // One running total per user-defined tracker category (id -> cumulative $).
  // Anything not in the fixed CATEGORIES is a tracker category by definition.
  const cum: Record<string, number> = {};
  for (const c of state.trackerCategories || []) cum[c.id] = 0;

  const rows = events.map((e) => {
    // a paid-override zeroes this event's effect on the balance, but it still
    // shows in the ledger (struck through) so the row stays visible
    const delta = e.paidOverride ? 0 : e.amount;
    bal += e.direction === "in" ? delta : -delta;

    // step the matching tracker column — the category IS the tracker
    let stepped = null;
    if (!CATEGORIES[e.category] && e.category in cum) {
      cum[e.category]! += e.amount;
      stepped = { key: e.category, value: round(cum[e.category]!) };
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
export function groupByMonth(rows: LedgerRow[]): Array<{ label: string; rows: LedgerRow[] }> {
  const groups: Array<{ label: string; rows: LedgerRow[] }> = [];
  let current: { label: string; rows: LedgerRow[] } | null = null;
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
export function computeBudget(state: BudgetState, horizonISO: ISODate): BudgetColumn[] {
    // The last column represents horizonISO's WHOLE calendar month (see
    // monthsBetween below — it's day-agnostic), but horizonISO itself is a
    // specific date that always shares checkInDate's day-of-month. Without
    // this, any bill due later in that final month than checkInDate's day
    // would silently be missing from the last column — a real bug users
    // hit constantly, since most bills aren't due on the same day checkIn
    // happens to be set to.
    const events = buildEvents(state, endOfMonthISO(horizonISO));
    const months = monthsBetween(primaryAccount(state).balanceAsOf, horizonISO);

    const byMonth: Record<string, any> = {};
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
    let prevCumulative = Number(primaryAccount(state).balance) || 0;
    const startBalance = Number(primaryAccount(state).balance) || 0;

    const cols = months.map((m, idx) => {
      const b = byMonth[m.key];
      const takeHome = b.takeHome;
      // split the aggregated-by-name items into non-paycheck income vs expenses
      let otherIn = 0, out = 0;
      const incomeItems: Record<string, any> = {}, expenseItems: Record<string, any> = {};
      for (const [name, obj] of Object.entries(b.items) as Array<[string, any]>) {
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
  
function incomeItemsExceptPay(incomeItems: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [name, obj] of Object.entries(incomeItems)) {
      if (!PAY_RE.test(name)) out[name] = obj;
    }
    return out;
}

// ---- helpers ----
function round(n: number): number { return Math.round(n * 100) / 100; }

function monthLabel(iso: ISODate): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function monthsBetween(startISO: ISODate, endISO: ISODate): Array<{ key: MonthKey; label: string }> {
  const out: Array<{ key: MonthKey; label: string }> = [];
  const d = new Date(startISO.slice(0, 7) + "-01T00:00:00");
  const end = new Date(endISO.slice(0, 7) + "-01T00:00:00");
  let guard = 0;
  while (d <= end && guard < 240) {
    guard++;
    const key = toISODate(d).slice(0, 7); // local — see toISODate in model.ts
    out.push({ key, label: d.toLocaleString("en-US", { month: "short", year: "numeric" }) });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}
// ---- Spending mix: where the PLANNED outflow goes, by category ----
// Built from buildEvents — the same list the Ledger renders — so it covers
// exactly the window the horizon slider is showing and moves with it.
//
// This is FORECAST data and says so on the card. It never touches
// monthlyActuals, balanceSnapshots or contributionLog: an actual-spending
// breakdown is a different chart on a different tab, and mixing the two is
// the error this codebase keeps having to undo.
//
// Three deliberate exclusions:
//  - income, so the slices sum to outflow rather than to churn;
//  - paid-marked instances, which contribute 0 to the projection because the
//    money is already inside the verified balance — counting them would show
//    spending the forecast does not contain;
//  - nothing else. Orphaned categories keep their amount under one
//    "Uncategorized" slice rather than vanishing.
//
// Beyond MAX_SLICES the tail folds into "Other". The 8-colour palette is the
// reason: a 9th category can't get a generated hue without breaking the
// categorical colour rules, so it folds instead.
const MAX_SLICES = 8;

export function computeSpendingByCategory(state: BudgetState, horizonISO: ISODate): SpendingMix {
  const from = primaryAccount(state).balanceAsOf;
  const events = buildEvents(state, horizonISO);
  const cats = state.trackerCategories || [];

  const totals = new Map<string, number>();
  for (const e of events) {
    if (e.direction !== "out" || e.paidOverride) continue;
    totals.set(e.category, round((totals.get(e.category) ?? 0) + e.amount));
  }

  const describe = (categoryId: string): Pick<SpendingSlice, "label" | "color" | "bucket"> => {
    if (categoryId === "bill") return { label: "Fixed bills", color: null, bucket: "bill" };
    if (categoryId === "oneoff") return { label: "One-off", color: null, bucket: "oneoff" };
    const cat = cats.find((c) => c.id === categoryId);
    if (!cat) return { label: "Uncategorized", color: null, bucket: "uncategorized" };
    return { label: cat.name, color: cat.color, bucket: "category" };
  };

  const total = round([...totals.values()].reduce((s, v) => s + v, 0));
  let slices: SpendingSlice[] = [...totals.entries()]
    .map(([key, amount]) => ({ key, amount, percent: 0, ...describe(key) }))
    .sort((a, b) => b.amount - a.amount);

  // Orphans from several deleted categories collapse into one slice.
  const orphans = slices.filter((s) => s.bucket === "uncategorized");
  if (orphans.length > 1) {
    const merged = round(orphans.reduce((s, o) => s + o.amount, 0));
    slices = slices.filter((s) => s.bucket !== "uncategorized");
    slices.push({ key: "__uncategorized__", label: "Uncategorized", amount: merged, percent: 0, color: null, bucket: "uncategorized" });
    slices.sort((a, b) => b.amount - a.amount);
  }

  if (slices.length > MAX_SLICES) {
    const keep = slices.slice(0, MAX_SLICES - 1);
    const rest = slices.slice(MAX_SLICES - 1);
    keep.push({
      key: "__other__",
      label: `Other (${rest.length})`,
      amount: round(rest.reduce((s, r) => s + r.amount, 0)),
      percent: 0,
      color: null,
      bucket: "other",
    });
    slices = keep;
  }

  for (const s of slices) s.percent = total > 0 ? round((s.amount / total) * 100) : 0;

  return { slices, total, from, to: horizonISO };
}
