import type { ISODate, LedgerRow } from "./types.ts";

// THE MONTH GRID'S ARITHMETIC, in one place, for both clients.
//
// WHAT THE CALENDAR USED TO SAY, and why it was rebuilt on 2026-10-17:
// each cell showed the day's NET — "+2,400" on payday, "−1,650" on the
// first. That is a true number and almost nobody's question. What a
// person opens a calendar to find out is "where does my checking
// balance land on the 27th" — the thing the Ledger's running-balance
// column answers one row at a time and the grid could not answer at
// all. Net is now gone from both clients; the cell carries the
// PROJECTED END-OF-DAY BALANCE and the detail panel leads with it.
//
// THREE DATES, AND THEY ARE NOT THE SAME DATE. Confusing them is how
// the old grid got "today" wrong:
//
//   - `today` is the DEVICE's current date. It is passed in rather
//     than read here so this file stays pure, and it is never derived
//     from the anchor: somebody who last checked their bank on the 3rd
//     is still living on the 17th, and a calendar that bolds the 3rd
//     is telling them the wrong thing about where they are.
//   - `anchor` is the as-of date of the checking balance. Before it
//     there is no forecast — the balance already accounts for whatever
//     happened — so those days are marked `dim` and carry no number.
//   - `horizon` is the end of the Ledger's window. After it the rules
//     have not been run, so a cell there would be showing the last
//     projected balance as though nothing further happens. Also `dim`.
//
// The grid is Sunday-first and padded to whole weeks with nulls, which
// is what lets both clients lay it out as seven columns without either
// of them knowing how many days February has.

export interface CalendarDay {
  date: ISODate;
  /** 1–31, for the cell's corner. */
  day: number;
  /** The projected checking balance at the END of this day, or null
   *  where there is no forecast — see the note on `dim`. */
  balance: number | null;
  /** Anything at all happens on this day. ONE marker, not one per row:
   *  the cell's room goes to the balance now, and "something here" is
   *  the whole of what a dot was ever able to say. */
  busy: boolean;
  rows: LedgerRow[];
  /** The device's current date. Its own marker on both clients, and
   *  deliberately not the same marker as the selected day. */
  isToday: boolean;
  /** No forecast covers this day: before the anchor, or past the
   *  horizon. Drawn faded, and its detail panel says which. */
  dim: boolean;
}

export interface CalendarMonth {
  /** "2026-10". */
  key: string;
  /** Whole weeks, Sunday first. `null` is a leading or trailing pad. */
  cells: (CalendarDay | null)[];
}

const monthKeyOf = (iso: ISODate): string => iso.slice(0, 7);

/** The number of days in a "YYYY-MM", without constructing a Date per day. */
export function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(y!, m!, 0).getDate();
}

/** Which weekday "YYYY-MM-01" falls on, 0 = Sunday. */
function leadingBlanks(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(y!, m! - 1, 1).getDay();
}

/** "2026-10" plus n months, wrapping the year. */
export function addMonthKey(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Every month the calendar can page through, oldest first.
 *
 * TODAY'S MONTH IS ALWAYS IN IT, which the old web version could not
 * promise: it built the list from the months the rows happen to fall
 * in, so an account whose ledger starts next month opened on a grid
 * with no today in it at all — and "opening the calendar selects
 * today" has to be a thing that can happen.
 *
 * Contiguous, so paging never jumps over an empty month and leaves
 * somebody wondering what is in it.
 */
export function calendarMonths(rows: LedgerRow[], anchor: ISODate, today: ISODate): string[] {
  const todayKey = monthKeyOf(today);
  let first = monthKeyOf(anchor) < todayKey ? monthKeyOf(anchor) : todayKey;
  let last = todayKey;
  for (const r of rows) {
    const k = monthKeyOf(r.date);
    if (k < first) first = k;
    if (k > last) last = k;
  }
  const out: string[] = [];
  for (let k = first; k <= last; k = addMonthKey(k, 1)) out.push(k);
  return out;
}

/**
 * One month of cells, with a balance on every day the forecast covers.
 *
 * `rows` is the WHOLE ledger, not this month's slice: the balance on
 * the 1st is carried in from everything before it, and handing this
 * function a month at a time is exactly how that gets lost.
 * `startBalance` is the anchor — what the ledger counts forward from.
 */
export function buildCalendarMonth(
  key: string,
  rows: LedgerRow[],
  startBalance: number,
  anchor: ISODate,
  today: ISODate,
  horizon: ISODate,
): CalendarMonth {
  const byDate = new Map<ISODate, LedgerRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }

  // The running balance walked forward from the anchor to this month's
  // first day, then day by day through it. `rows` carries its own
  // running total, so the balance at the end of a day is simply the
  // last row of the last day at or before it — no re-adding, and no
  // chance of this disagreeing with the Ledger's column.
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let i = 0;
  let running = startBalance;

  const n = daysInMonth(key);
  const cells: (CalendarDay | null)[] = Array.from({ length: leadingBlanks(key) }, () => null);
  for (let d = 1; d <= n; d++) {
    const date = `${key}-${String(d).padStart(2, "0")}`;
    while (i < sorted.length && sorted[i]!.date <= date) { running = sorted[i]!.balance; i++; }
    const dim = date < anchor || date > horizon;
    cells.push({
      date,
      day: d,
      balance: dim ? null : running,
      busy: byDate.has(date),
      rows: byDate.get(date) ?? [],
      isToday: date === today,
      dim,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return { key, cells };
}

/**
 * The cell number on a WIDE screen: "$2,545", "-$820".
 *
 * Whole dollars on both clients. Cents in a cell are four characters
 * nobody reads at a glance, and the detail panel below carries the
 * exact figure for the day you actually asked about.
 */
export function cellAmountFull(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString("en-US")}`;
}

/**
 * The cell number on a PHONE: "2,545", "12.3k", "-820".
 *
 * No dollar sign and no cents, because the cell is about 39pt wide at
 * the narrowest iPhone this runs on and the column heading above it
 * has already established that these are dollars. A negative is a
 * minus and nothing else — no red, no tint. The calendar is a map of
 * where the balance goes, and coloring the low days turns a map into
 * a warning, which is a judgment this app does not make here.
 *
 * The thresholds shorten rather than truncate: past $10k the hundreds
 * stop mattering at a glance, and past $100k so does the thousand.
 */
export function cellAmountCompact(n: number): string {
  const r = Math.round(n);
  const sign = r < 0 ? "-" : "";
  const v = Math.abs(r);
  if (v < 10_000) return sign + v.toLocaleString("en-US");
  const k = shorten(v / 1000);
  // ROUNDED FIRST, THEN BANDED. Doing it the other way round produces
  // "100.0k" at $99,950 and "1000k" at $999,600 — seven characters in
  // a cell measured for six, which is how a layout that was checked
  // still overflows on a number nobody tried.
  if (k !== null) return `${sign}${k}k`;
  const m = v / 1_000_000;
  return `${sign}${shorten(m) ?? Math.round(m)}m`;
}

/** One decimal below 100, whole above it, null once it reaches 1000. */
function shorten(x: number): string | null {
  const one = Math.round(x * 10) / 10;
  if (one < 100) return one.toFixed(1);
  const whole = Math.round(x);
  return whole < 1000 ? String(whole) : null;
}
