// ---- Compute everything the UI shows, from events + starting balance ----
import { buildEvents } from "./generate.ts";
import { CATEGORIES, categoryLabelOf, endOfMonthISO, primaryAccount, toISODate } from "./model.ts";
import { roleOfCategory } from "./palette.ts";
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
    for (const m of months) {
      byMonth[m.key] = { items: {}, otherItems: {}, takeHome: 0, payCount: 0, otherIn: 0 };
    }

    // WHAT INCOME IS SPLIT BY, since 2026-10-17: whether it recurs, not
    // what it is called.
    //
    // This row used to be everything whose NAME matched /pay|salary|
    // take.?home/i, which meant the budget's single most load-bearing
    // figure depended on a word. Income called "Disability", "Pension",
    // "SSI" or "Unemployment" — none of them a word that regex knows —
    // dropped out of take-home and landed in "other in", understating
    // the one row that answers "what comes in every month". Setup's
    // income step learned to take a name on the same day, which made
    // that reachable without ever opening the Ledger.
    //
    // Recurring is the honest test because it is the question the row
    // actually asks: take-home is income you can count on arriving
    // again, and a one-time payment is not, whatever either is called.
    // It also cannot be gotten wrong by typing — the cadence is picked
    // from a list.
    //
    // WHAT A ROW IS KEYED BY, since 2026-10-19: the item's id, with the
    // name carried alongside as a label.
    //
    // It was keyed by the name, and a name is not an identity. A $375
    // one-off "Discover Bill" and a $680 monthly "Discover Bill" are
    // two rules, and they collapsed into one entry per month — so the
    // layout listed the name once under ONE-OFF and once under FIXED,
    // both rows read the same single entry, and each month printed the
    // same figure twice. The totals were right the whole time, which is
    // what made it look like a display fault rather than a data one: it
    // was. Reported from a phone, true on the web for the same reason.
    for (const e of events) {
      const key = e.date.slice(0, 7);
      if (!byMonth[key]) continue;
      const b = byMonth[key];
      if (e.category === "income") {
        if (e.recurring) {
          // The SUM of every recurring income landing in this month, not
          // one rule's amount: 2 biweekly paydays is 2x and a 3-payday
          // month is 3x, which is the whole reason this row is computed.
          b.takeHome += e.amount;
          b.payCount += 1;
        } else {
          // A repayment from a friend, a rebate, a bonus: real money in,
          // and not a thing to plan next month around.
          b.otherIn += e.amount;
          b.otherItems[e.srcId] = {
            name: e.name,
            val: (b.otherItems[e.srcId]?.val || 0) + e.amount,
            order: e.order,
          };
        }
        continue;
      }
      // Still SUMMED per key, because one rule can fire more than once in
      // a month — a biweekly bill is two occurrences and one row.
      b.items[e.srcId] = {
        name: e.name,
        val: (b.items[e.srcId]?.val || 0) - e.amount,
        category: e.category,
        order: e.order,
      };
    }

    // starting point chains from prior month's cumulative; first month = check-in balance
    let prevCumulative = Number(primaryAccount(state).balance) || 0;
    const startBalance = Number(primaryAccount(state).balance) || 0;

    const cols = months.map((m, idx) => {
      const b = byMonth[m.key];
      const takeHome = b.takeHome;
      const otherIn = round(b.otherIn);
      // Income was split as it arrived; `items` holds the expenses alone,
      // keyed by item id and stored signed-negative.
      let out = 0;
      const expenseItems: Record<string, any> = {};
      for (const [id, obj] of Object.entries(b.items) as Array<[string, any]>) {
        out += -obj.val;
        expenseItems[id] = { name: obj.name, val: -obj.val, category: obj.category, order: obj.order };
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
        otherIn, otherInItems: b.otherItems,
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
// Beyond MAX_SLICES the tail folds into "Other". Eight rows beside their
// own labels is what the list has always shown, and with the pie gone
// this is the only fold there is — the second one existed because a
// four-step ramp could not carry more wedges, and there is no ramp now.
const MAX_SLICES = 8;

// The two FIXED buckets are not categories in the sense the others are. A
// tracker category is a bucket the user made and named on purpose; "bill" is
// where anything they did NOT categorize lands. Drawing it as one slice is
// grouping by "uncategorized", which says as little at 40% as at 100% — so
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

  const describe = (categoryId: string): Pick<SpendingSlice, "label" | "bucket" | "role" | "hue"> => {
    const role = roleOfCategory(categoryId, cats);
    if (categoryId === "bill") return { label: categoryLabelOf("bill", { plural: true }), bucket: "bill", role };
    if (categoryId === "oneoff") return { label: "One-off", bucket: "oneoff", role };
    const cat = cats.find((c) => c.id === categoryId);
    if (!cat) return { label: "Uncategorized", bucket: "uncategorized", role };
    // The account's own hue rides along, so a view never has to look a
    // category up to paint its slice and the two clients cannot disagree
    // about what color an account is.
    return { label: cat.name, bucket: "category", role, hue: cat.hue ?? null };
  };

  /** One broken-out transaction: who it is, what to call it, what it cost. */
  type MixItem = { id: string; name: string; amount: number; variable: boolean };

  // The transactions inside one bucket, biggest first, each RULE summed —
  // three months of "Rent" is one slice, not three.
  //
  // Summed by item id rather than by name, since 2026-10-19, for the
  // reason computeBudget is: two rules can share a name, and merging
  // them made one slice that belonged to neither. It also makes the
  // label below answerable — "this bill varies" is a property of a
  // rule, and a merged pair can have one of each.
  const itemsOf = (categoryId: string): MixItem[] => {
    const byItem = new Map<string, MixItem>();
    for (const e of events) {
      if (e.direction !== "out" || e.category !== categoryId) continue;
      const at = byItem.get(e.srcId);
      if (at) at.amount = round(at.amount + e.amount);
      else byItem.set(e.srcId, { id: e.srcId, name: e.name, amount: round(e.amount), variable: e.variable });
    }
    return [...byItem.values()].sort((a, b) => b.amount - a.amount);
  };

  const total = round([...totals.values()].reduce((s, v) => s + v, 0));
  let slices: SpendingSlice[] = [];
  for (const [key, amount] of totals) {
    const d = describe(key);
    // Items take their bucket's ROLE, which is what decides whether the
    // amount beside them is red. Not a color any more.
    const fixed = d.bucket === "bill" || d.bucket === "oneoff" ? d.bucket : null;
    const items = fixed ? itemsOf(key) : [];
    if (fixed && items.length > 0) {
      items.forEach((it) => slices.push({
        key: `${key}::${it.id}`,
        label: it.name,
        amount: it.amount,
        percent: 0,
        bucket: "item",
        role: d.role,
        parentBucket: fixed,
        // THE ITEM'S OWN LABEL, not the bucket's. A bill the user has
        // marked as varying reads "Groceries · Variable bill" — the
        // bucket is still `bill` and the arithmetic is untouched, but
        // the word beside it now agrees with what they told the form.
        //
        // SINGULAR, because this row is ONE item. The plural reads as
        // a claim about a group, and the only group label left is the
        // whole-bucket slice in `describe()` — which, as it happens,
        // no input reaches, since a bill or one-off bucket always
        // breaks out into its items. It keeps the plural anyway, so
        // the fallback cannot start calling a bucket by a row's name.
        parentLabel: categoryLabelOf(key, { variable: it.variable }, cats),
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
    slices.push({ key: "__uncategorized__", label: "Uncategorized", amount: merged, percent: 0, bucket: "uncategorized", role: "uncategorized" });
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
      bucket: "other",
      role: "uncategorized",
      // The fold KEEPS its members rather than discarding them. "Other" is
      // otherwise the one slice you can learn nothing from — the same
      // complaint as a single "Fixed bills" wedge, a layer down — so the
      // view can open it on demand. Expanded, they are gray like the row
      // they came out of: the ramp is a ranking, and the tail is the part
      // that is deliberately not ranked.
      children: rest,
    });
    slices = keep;
  }

  for (const s of slices) {
    s.percent = total > 0 ? round((s.amount / total) * 100) : 0;
    // Children are percentages OF THE WINDOW, not of Other, so an expanded
    // row can be compared with the slices above it.
    for (const c of s.children ?? []) c.percent = total > 0 ? round((c.amount / total) * 100) : 0;
  }

  return { slices, total, from, to: horizonISO };
}



/**
 * Which rows on screen right now would vanish if the anchor moved to
 * `newAsOf` — the preview behind the "log balance" confirmation.
 *
 * WHY THIS NEEDS SAYING OUT LOUD. `buildEvents` drops every event
 * strictly before the verified balance's date, because that balance
 * already contains them and counting them again would double them.
 * That is correct and it is invisible: logging today's balance silently
 * removes the bills and paychecks still sitting in the ledger from
 * earlier in the month, and the only clue is that the list got shorter.
 *
 * The dangerous case is the honest mistake — a bill dated the 3rd that
 * has NOT actually gone out yet. Moving the anchor past it does not
 * make it paid, it makes it invisible, and the forecast is then too
 * high by that amount for ever.
 *
 * The comparison is `< newAsOf`, and it is `<` for the same reason
 * `buildEvents` keeps same-day events: a row dated exactly on the new
 * as-of date survives.
 *
 * Returns rows in the order the ledger shows them, so the confirmation
 * reads in the same order as the screen behind it.
 */
export function rowsHiddenByAnchor(
  state: BudgetState, newAsOf: ISODate, horizonISO: ISODate,
): LedgerRow[] {
  return computeLedger(state, horizonISO).rows.filter((r) => r.date < newAsOf);
}
