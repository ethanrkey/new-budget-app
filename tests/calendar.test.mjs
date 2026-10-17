// The month grid's arithmetic, tested without a renderer.
//
//   node tests/calendar.test.mjs     (runs in `npm test`, so in CI)
//
// The calendar was rebuilt on 2026-10-17 around the projected
// end-of-day checking balance, replacing the day's net. Net was a true
// number and almost nobody's question; "where does my balance land on
// the 27th" is the question, and a seven-column grid could not answer
// it because the running balance lived in the list view's column.
//
// So the thing worth testing is that the grid and the list CANNOT
// DISAGREE — the cell for a day has to be the same number the Ledger's
// last row of that day shows — and that the three dates the grid deals
// in stay separate: the device's today, the balance's as-of date, and
// the end of the Ledger window.
import { normalize } from "../src/engine/stateShape.ts";
import { computeLedger } from "../src/engine/compute.ts";
import { upsertItem, updateAccountBalance } from "../src/engine/mutate.ts";
import {
  calendarMonths, buildCalendarMonth, addMonthKey, daysInMonth,
  cellAmountCompact, cellAmountFull,
} from "../src/engine/calendar.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, c) => eq(label, !!c, true);
const not = (label, c) => eq(label, !!c, false);

const ANCHOR = "2026-10-05";
const TODAY = "2026-10-17";
const HORIZON = "2026-12-31";

// An account anchored at $4,000 on the 5th, with rent out on the 10th
// and a paycheck in on the 16th and every two weeks after.
let state = normalize({});
state = updateAccountBalance(state, "checking", 4000, ANCHOR);
state = upsertItem(state, {
  id: "rent", name: "Rent", amount: 1500, category: "bill",
  cadence: "monthly", dayOfMonth: 10, startDate: "2026-01-10",
});
state = upsertItem(state, {
  id: "pay", name: "Paycheck", amount: 1800, category: "income",
  cadence: "biweekly", startDate: "2026-10-16",
});
const ledger = computeLedger(state, HORIZON);
const cells = (key) =>
  buildCalendarMonth(key, ledger.rows, 4000, ANCHOR, TODAY, HORIZON).cells;
const at = (key, d) => cells(key).find((c) => c && c.day === d);

// ---- the grid and the list cannot disagree -------------------------
{
  // THE INVARIANT. For every day with rows, the cell's balance is the
  // balance of that day's LAST ledger row — the same number the list
  // view prints in its running-balance column. Checked for the whole
  // window rather than for one day, because the failure mode worth
  // catching is an off-by-one in the walk, which a single day hides.
  const lastOfDay = new Map();
  for (const r of ledger.rows) lastOfDay.set(r.date, r.balance);

  let mismatches = 0, compared = 0;
  for (const key of ["2026-10", "2026-11", "2026-12"]) {
    for (const c of cells(key)) {
      if (!c || !lastOfDay.has(c.date)) continue;
      compared++;
      if (c.balance !== lastOfDay.get(c.date)) mismatches++;
    }
  }
  is("there are days to compare at all", compared > 5);
  eq("every busy cell shows the Ledger's own running balance", mismatches, 0);
}

// ---- a quiet day carries the balance forward -----------------------
{
  eq("the anchor day itself is the anchor", at("2026-10", 5).balance, 4000);
  eq("...and the day after, with nothing on it, is still the anchor",
    at("2026-10", 6).balance, 4000);
  eq("rent comes out on the 10th", at("2026-10", 10).balance, 2500);
  eq("...and the 11th, which is quiet, holds that", at("2026-10", 11).balance, 2500);
  eq("the paycheck lands on the 16th", at("2026-10", 16).balance, 4300);
  // The one that proves the walk crosses a month boundary rather than
  // restarting: November's 1st is October's 31st, not the anchor.
  eq("November starts where October ended",
    at("2026-11", 1).balance, at("2026-10", 31).balance);
}

// ---- a day with several rows takes the LAST one --------------------
{
  // Rent and a paycheck on the same date. The cell is the END of the
  // day, so the order the two land in must not change the answer.
  let busy = updateAccountBalance(normalize({}), "checking", 1000, ANCHOR);
  busy = upsertItem(busy, {
    id: "a", name: "Bill", amount: 300, category: "bill",
    cadence: null, date: "2026-10-20",
  });
  busy = upsertItem(busy, {
    id: "b", name: "Bonus", amount: 500, category: "income",
    cadence: null, date: "2026-10-20",
  });
  const l = computeLedger(busy, HORIZON);
  const c = buildCalendarMonth("2026-10", l.rows, 1000, ANCHOR, TODAY, HORIZON)
    .cells.find((x) => x && x.day === 20);
  eq("two rows on one day leave one end-of-day balance", c.balance, 1200);
  eq("...and both are in its detail", c.rows.length, 2);
  is("...and the day is marked busy", c.busy);
}

// ---- the three dates are three dates -------------------------------
{
  const oct = cells("2026-10");
  eq("exactly one day is today", oct.filter((c) => c && c.isToday).length, 1);
  eq("...and it is the DEVICE's date, not the anchor's",
    oct.find((c) => c && c.isToday).date, TODAY);
  not("the anchor day is not marked today", at("2026-10", 5).isToday);

  // Before the anchor there is no forecast: the balance already
  // accounts for whatever happened then.
  is("the day before the anchor is dimmed", at("2026-10", 4).dim);
  eq("...and carries no number", at("2026-10", 4).balance, null);
  not("the anchor day itself is not dimmed", at("2026-10", 5).dim);

  // After the horizon the rules have not been run, so a number there
  // would be the last projection pretending nothing further happens.
  is("the day after the horizon is dimmed",
    buildCalendarMonth("2027-01", ledger.rows, 4000, ANCHOR, TODAY, HORIZON)
      .cells.find((c) => c && c.day === 1).dim);
  not("the horizon day itself is not", at("2026-12", 31).dim);
}

// ---- which months you can page through -----------------------------
{
  const months = calendarMonths(ledger.rows, ANCHOR, TODAY);
  eq("the window is contiguous and covers the ledger",
    months, ["2026-10", "2026-11", "2026-12"]);
  is("today's month is in it", months.includes(TODAY.slice(0, 7)));

  // THE CASE THE OLD WEB VERSION COULD NOT HANDLE: it built the list
  // out of the months the rows fall in, so an account whose ledger
  // starts next month opened on a grid with no today in it — and
  // "opening the calendar selects today" has to be possible.
  const future = calendarMonths(
    [{ date: "2027-03-04", balance: 1, id: "x", name: "n", amount: 1, direction: "out", category: "bill" }],
    "2027-01-01", "2026-10-17",
  );
  eq("a ledger that starts later still includes today's month", future[0], "2026-10");
  eq("...and runs to the last row without a gap", future.length, 6);
  eq("...ending where the rows do", future[future.length - 1], "2027-03");

  eq("paging crosses a year end", addMonthKey("2026-12", 1), "2027-01");
  eq("...and a year start", addMonthKey("2027-01", -1), "2026-12");
  eq("...and a whole year", addMonthKey("2026-05", 12), "2027-05");
}

// ---- the grid keeps its shape --------------------------------------
{
  for (const key of ["2026-01", "2026-02", "2024-02", "2026-09", "2026-10"]) {
    const c = buildCalendarMonth(key, ledger.rows, 4000, ANCHOR, TODAY, HORIZON).cells;
    eq(`${key} is whole weeks`, c.length % 7, 0);
    eq(`${key} has its own number of days`,
      c.filter(Boolean).length, daysInMonth(key));
  }
  eq("a leap February has 29", daysInMonth("2024-02"), 29);
  eq("...and a common one 28", daysInMonth("2026-02"), 28);
  // 2026-10-01 is a Thursday, so four blanks lead the grid.
  eq("the first of the month lands on its own weekday",
    cells("2026-10").findIndex((c) => c !== null), 4);
}

// ---- the cell number ------------------------------------------------
{
  // Whole dollars, no cents, on both clients.
  eq("the web cell carries the dollar sign", cellAmountFull(2545.37), "$2,545");
  eq("...and a negative is a minus and nothing else", cellAmountFull(-820.4), "-$820");
  eq("...and zero is zero", cellAmountFull(0), "$0");

  // The phone's cell is 43pt of usable width at the narrowest iPhone
  // that can run this, so: no dollar sign, no cents, shortened past
  // $10k. See the note at the top of mobile/components/CalendarView.
  eq("under ten thousand keeps its digits", cellAmountCompact(2545.37), "2,545");
  eq("a negative is a minus and nothing else", cellAmountCompact(-820.4), "-820");
  eq("nine thousand is still digits", cellAmountCompact(9999.4), "9,999");
  eq("ten thousand shortens", cellAmountCompact(12345), "12.3k");
  eq("...and rounds rather than truncating", cellAmountCompact(12360), "12.4k");
  eq("past a hundred thousand the decimal goes", cellAmountCompact(250_000), "250k");
  eq("past a million it is m", cellAmountCompact(1_250_000), "1.3m");
  eq("and big negatives still just carry a minus", cellAmountCompact(-45_600), "-45.6k");

  // ROUNDED FIRST, THEN BANDED. The other way round gives "100.0k" at
  // $99,950 and "1000k" at $999,600 — seven characters in a cell
  // measured for six, which is how a layout that was checked still
  // overflows on a number nobody tried.
  eq("the top of the k band rounds up into the next shape",
    cellAmountCompact(99_950), "100k");
  eq("...and the top of it promotes to m rather than reaching 1000k",
    cellAmountCompact(999_600), "1.0m");

  // THE BOUND THE CELL WAS MEASURED AGAINST. Two shapes reach six
  // characters — "-9,999" and "-99.9k" — and the first is the wider
  // of the two in SF Pro with tabular figures, because a comma plus
  // four digits beats two digits, a period, one digit and a letter.
  // That is the string the 36.6pt in CalendarView's note refers to.
  let longest = 0;
  const shapes = new Set();
  for (let v = -2_000_000; v <= 2_000_000; v += 977) {
    const s = cellAmountCompact(v);
    if (s.length > longest) { longest = s.length; shapes.clear(); }
    if (s.length === longest) shapes.add(s.replace(/\d/g, "9"));
  }
  eq("no balance under two million is longer than six characters", longest, 6);
  eq("...and only two shapes get there", [...shapes].sort(), ["-9,999", "-99.9k"]);
}

if (checks < 20) {
  console.log(`FAIL  this suite ran only ${checks} checks — truncated, or short-circuited before the end`);
  failures++;
}
console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
