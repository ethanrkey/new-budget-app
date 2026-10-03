// ---- Compute everything the UI shows, from events + starting balance ----
import { buildEvents } from "./generate.ts";
import { CATEGORIES, endOfMonthISO, primaryAccount, toISODate } from "./model.ts";
import { roleOfCategory, assignShades } from "./palette.ts";
import type {
  BudgetColumn, BudgetState, DayGroup, ISODate, Ledger, LedgerRow, MonthKey, SpendingMix, SpendingSlice,
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
    bal += e.direction === "in" ? e.amount : -e.amount;

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

// Group rows by calendar day for the Ledger's calendar view. Returns a Map
// keyed by ISO date so a month grid can look a day up directly, in the row
// order the ledger already produced.
//
// `net` treats a paid-marked row as 0, exactly as the running balance does —
// the day's figure and the balance must never tell different stories. The row
// is still present in `rows` (and so still gets a dot), because it did happen.
export function groupByDay(rows: LedgerRow[]): Map<ISODate, DayGroup> {
  const days = new Map<ISODate, DayGroup>();
  for (const r of rows) {
    let day = days.get(r.date);
    if (!day) {
      day = { date: r.date, rows: [], net: 0, inflow: 0, outflow: 0 };
      days.set(r.date, day);
    }
    day.rows.push(r);
    if (r.direction === "in") day.inflow = round(day.inflow + r.amount);
    else day.outflow = round(day.outflow + r.amount);
    day.net = round(day.inflow - day.outflow);
  }
  return days;
}

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
      const signed = e.direction === "in" ? e.amount : -e.amount;
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

// The two FIXED buckets are not categories in the sense the others are. A
// tracker category is a bucket the user made and named on purpose; "bill" is
// where anything they did NOT categorise lands. Drawing it as one slice is
// grouping by "uncategorised", which says as little at 40% as at 100% — so
// these always break out by item. No threshold: the chart must not change
// shape as the horizon slider moves. Tracker categories always stay whole;
// grouping them is the whole reason they exist.
//
// "Uncategorized" stays whole too, deliberately. It is not a place things
// land by default — it only holds transactions whose category was deleted —
// and seeing that lump whole is what sends you off to re-file them.
const ALWAYS_BY_ITEM: ReadonlySet<string> = new Set(["bill", "oneoff"]);

export function computeSpendingByCategory(state: BudgetState, horizonISO: ISODate): SpendingMix {
  const from = primaryAccount(state).balanceAsOf;
  const events = buildEvents(state, horizonISO);
  const cats = state.trackerCategories || [];

  const totals = new Map<string, number>();
  for (const e of events) {
    if (e.direction !== "out") continue;
    totals.set(e.category, round((totals.get(e.category) ?? 0) + e.amount));
  }

  // `color` is retained on the slice only because the shape is public; it
  // is no longer what anything paints with. Colour comes from `role`.
  const describe = (categoryId: string): Pick<SpendingSlice, "label" | "color" | "bucket" | "role"> => {
    const role = roleOfCategory(categoryId, cats);
    if (categoryId === "bill") return { label: "Fixed bills", color: null, bucket: "bill", role };
    if (categoryId === "oneoff") return { label: "One-off", color: null, bucket: "oneoff", role };
    const cat = cats.find((c) => c.id === categoryId);
    if (!cat) return { label: "Uncategorized", color: null, bucket: "uncategorized", role };
    return { label: cat.name, color: null, bucket: "category", role };
  };

  // The transactions inside one bucket, biggest first, same-named ones
  // summed — three months of "Rent" is one slice, not three.
  const itemsOf = (categoryId: string): [string, number][] => {
    const byItem = new Map<string, number>();
    for (const e of events) {
      if (e.direction !== "out" || e.category !== categoryId) continue;
      byItem.set(e.name, round((byItem.get(e.name) ?? 0) + e.amount));
    }
    return [...byItem.entries()].sort((a, b) => b[1] - a[1]);
  };

  const total = round([...totals.values()].reduce((s, v) => s + v, 0));
  let slices: SpendingSlice[] = [];
  for (const [key, amount] of totals) {
    const d = describe(key);
    // Items take their bucket's ROLE, shaded per sibling by the view.
    // Shades are assigned once at the end, across everything sharing a
    // role, so they do not have to be guessed here.
    const fixed = d.bucket === "bill" || d.bucket === "oneoff" ? d.bucket : null;
    const items = fixed ? itemsOf(key) : [];
    if (fixed && items.length > 0) {
      items.forEach(([name, amt]) => slices.push({
        key: `${key}::${name}`,
        label: name,
        amount: amt,
        percent: 0,
        color: d.color,
        bucket: "item",
        role: d.role,
        parentBucket: fixed,
        parentLabel: d.label,
      }));
      continue;
    }
    slices.push({ key, amount, percent: 0, ...d });
  }
  slices.sort((a, b) => b.amount - a.amount);

  // Orphans from several deleted categories collapse into one slice.
  const orphans = slices.filter((s) => s.bucket === "uncategorized");
  if (orphans.length > 1) {
    const merged = round(orphans.reduce((s, o) => s + o.amount, 0));
    slices = slices.filter((s) => s.bucket !== "uncategorized");
    slices.push({ key: "__uncategorized__", label: "Uncategorized", amount: merged, percent: 0, color: null, bucket: "uncategorized", role: "uncategorized" });
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
      role: "uncategorized",
      // The fold KEEPS its members rather than discarding them. "Other" is
      // otherwise the one slice you can learn nothing from — the same
      // complaint as a single "Fixed bills" wedge, a layer down — so the
      // view can open it on demand. They keep the colours they already had;
      // nothing new is allocated from the palette.
      children: rest,
    });
    slices = keep;
  }

  // Shades span everything sharing a role in THIS chart — four investments
  // or five loans share a hue by design, and the shade is what tells them
  // apart in a pie.
  assignShades(slices);

  for (const s of slices) {
    s.percent = total > 0 ? round((s.amount / total) * 100) : 0;
    // Children are percentages OF THE WINDOW, not of Other, so an expanded
    // row can be compared with the slices above it.
    for (const c of s.children ?? []) c.percent = total > 0 ? round((c.amount / total) * 100) : 0;
  }

  return { slices, total, from, to: horizonISO };
}
