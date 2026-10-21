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
  cellAmountCompact, cellAmountFull, netAmountCompact, netAmountFull,
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
const SNAPS = [
  // Real history: three readings before the anchor, and the anchor's
  // own. Everything else before it stays blank, which is the point.
  { id: "s1", date: "2026-08-14", amount: 2150.25 },
  { id: "s2", date: "2026-09-02", amount: 3310 },
  { id: "s3", date: "2026-09-28", amount: 2890.5 },
  { id: "s4", date: ANCHOR, amount: 4000 },
];
const build = (key, extra = {}) => buildCalendarMonth({
  key, rows: ledger.rows, startBalance: 4000,
  anchor: ANCHOR, today: TODAY, horizon: HORIZON, ...extra,
});
const cells = (key) => build(key).cells;
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
  const c = buildCalendarMonth({
    key: "2026-10", rows: l.rows, startBalance: 1000,
    anchor: ANCHOR, today: TODAY, horizon: HORIZON,
  }).cells.find((x) => x && x.day === 20);
  eq("two rows on one day leave one end-of-day balance", c.balance, 1200);
  eq("...and both are in its detail", c.rows.length, 2);
  is("...and the day is marked busy", c.busy);

  // AND SO IS A DAY WITH ONE ROW ON IT, which is the ordinary case
  // and the one nothing checked: every busy assertion in this file
  // used a day holding two, so `rows.length > 0` could become
  // `> 1` and only the rare day would still be marked. A single
  // bill is exactly when someone wants the dot.
  const solo = computeLedger(upsertItem(busy, {
    id: "c", name: "Phone", amount: 40, category: "bill",
    cadence: null, date: "2026-10-22",
  }), HORIZON);
  const one = buildCalendarMonth({
    key: "2026-10", rows: solo.rows, startBalance: 1000,
    anchor: ANCHOR, today: TODAY, horizon: HORIZON,
  }).cells.find((x) => x && x.day === 22);
  eq("...and the 22nd holds exactly one", one.rows.length, 1);
  is("a day holding a single row is busy too", one.busy);
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
    build("2027-01")
      .cells.find((c) => c && c.day === 1).dim);
  not("the horizon day itself is not", at("2026-12", 31).dim);
}

// ---- REAL HISTORY, and only real history ----------------------------
//
// The days before the anchor could be filled by running the rules
// backwards. The result would be fiction: a rule says what is
// SUPPOSED to happen and the past is what did. So a past cell holds
// one logged reading or nothing, and it is tagged either way.
{
  const withHistory = (key) => build(key, { snapshots: SNAPS }).cells;
  const on = (key, d) => withHistory(key).find((c) => c && c.day === d);

  eq("a past day the user logged a balance on shows what they logged",
    on("2026-09", 2).logged, 3310);
  eq("...and has no forecast balance, because there is none",
    on("2026-09", 2).balance, null);
  eq("...so it is NOT drawn faded — it holds a fact", on("2026-09", 2).dim, false);
  is("...while still being outside the forecast", on("2026-09", 2).outsideForecast);

  // THE WHOLE POINT: everything else in that month stays blank.
  const sept = withHistory("2026-09").filter(Boolean);
  eq("exactly the logged days carry a number",
    sept.filter((c) => c.logged != null).map((c) => c.day), [2, 28]);
  eq("...and every other day of it is blank and faded",
    sept.filter((c) => c.logged == null && !c.dim).length, 0);
  eq("...with no balance invented for any of them",
    sept.filter((c) => c.balance != null).length, 0);

  // Nothing is generated for a day a rule WOULD have fired on. Rent
  // is monthly on the 10th and September is before the anchor.
  eq("a past day a rule would have hit is still blank",
    [on("2026-09", 10).logged, on("2026-09", 10).balance, on("2026-09", 10).dim],
    [null, null, true]);

  // The anchor's own reading is a forecast day, not a history day:
  // it is where the projection starts.
  eq("the anchor day keeps its forecast balance", on("2026-10", 5).balance, 4000);
  eq("...and carries the reading too, since that is what it is", on("2026-10", 5).logged, 4000);
  not("...and is not faded", on("2026-10", 5).dim);

  // Without the snapshots nothing changes — the history is opt-in
  // data, not a new default.
  eq("a calendar built with no snapshots is the old one",
    cells("2026-09").filter((c) => c && !c.dim).length, 0);

  // An imported file can carry two readings for one date; the
  // Dashboard upserts by date, so the last one wins here too.
  const twice = build("2026-09", {
    snapshots: [{ id: "a", date: "2026-09-02", amount: 1 }, { id: "b", date: "2026-09-02", amount: 2 }],
  }).cells.find((c) => c && c.day === 2);
  eq("two readings on one date leave one number", twice.logged, 2);
}

// ---- which months you can page through -----------------------------
{
  const months = calendarMonths(ledger.rows, ANCHOR, TODAY);
  eq("the window is contiguous and covers the ledger",
    months, ["2026-10", "2026-11", "2026-12"]);

  // BACK OVER THE HISTORY TOO. Rows begin at the anchor, so a list
  // built from them alone stops where the forecast starts — and the
  // months holding the logged readings would not be reachable at
  // all, which is most of what the history is for.
  eq("the logged months are reachable",
    calendarMonths(ledger.rows, ANCHOR, TODAY, SNAPS),
    ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
  eq("...and the window is still contiguous with a gap in the readings",
    calendarMonths(ledger.rows, ANCHOR, TODAY, [{ id: "x", date: "2026-05-11", amount: 1 }]),
    ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
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

  // THE MIRROR OF THAT CASE, and the one it does not cover: an
  // anchor BEFORE today. `future` has its anchor in 2027, so the
  // list starts at today's month whether the function takes the
  // earlier of the two or just takes today — the test passed either
  // way. A forecast that began two months ago has to be reachable.
  const began = calendarMonths(
    [{ date: "2026-08-20", balance: 1, id: "x", name: "n", amount: 1, direction: "out", category: "bill" }],
    "2026-08-01", TODAY,
  );
  eq("a ledger that began before today starts there, not at today", began[0], "2026-08");

  // WITH NOTHING IN THOSE MONTHS, which is what makes the anchor the
  // only thing that can say so. The case above has a row in August,
  // so the loop over rows reaches back there on its own and the
  // first line's `min` could be dropped without the test noticing.
  // An account anchored in August whose first row is in October is
  // the shape that needs the anchor read.
  const quiet = calendarMonths(
    [{ date: "2026-10-20", balance: 1, id: "x", name: "n", amount: 1, direction: "out", category: "bill" }],
    "2026-08-01", TODAY,
  );
  eq("...even with no rows or readings in them", quiet[0], "2026-08");

  // AND THE OTHER END. `last` starts at today's month and is only
  // ever pushed forward by a row or a reading, so a ledger lying
  // entirely in the past still has to run up to now — otherwise
  // "opening the calendar selects today" lands outside the list.
  eq("...and still runs to today's month", began[began.length - 1], TODAY.slice(0, 7));
  eq("...contiguously", began, ["2026-08", "2026-09", "2026-10"]);

  eq("paging crosses a year end", addMonthKey("2026-12", 1), "2027-01");
  eq("...and a year start", addMonthKey("2027-01", -1), "2026-12");
  eq("...and a whole year", addMonthKey("2026-05", 12), "2027-05");
}

// ---- the grid keeps its shape --------------------------------------
{
  for (const key of ["2026-01", "2026-02", "2024-02", "2026-09", "2026-10"]) {
    const c = build(key).cells;
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

// ---- which way the money moved, which the dots say in color --------
{
  // Rent out on the 10th, a paycheck in on the 16th, and the 16th is
  // the one that has to carry BOTH kinds of dot in the general case.
  eq("a day that only spends is out and not in",
    [at("2026-10", 10).hasOut, at("2026-10", 10).hasIn], [true, false]);
  eq("a day that only earns is in and not out",
    [at("2026-10", 16).hasIn, at("2026-10", 16).hasOut], [true, false]);

  let both = updateAccountBalance(normalize({}), "checking", 1000, ANCHOR);
  both = upsertItem(both, { id: "a", name: "Bill", amount: 300, category: "bill", cadence: null, date: "2026-10-20" });
  both = upsertItem(both, { id: "b", name: "Pay", amount: 500, category: "income", cadence: null, date: "2026-10-20" });
  const bothDay = buildCalendarMonth({
    key: "2026-10", rows: computeLedger(both, HORIZON).rows, startBalance: 1000,
    anchor: ANCHOR, today: TODAY, horizon: HORIZON,
  }).cells.find((c) => c && c.day === 20);
  eq("a payday that also pays a bill carries both", [bothDay.hasIn, bothDay.hasOut], [true, true]);
  eq("...and nets the difference", bothDay.net, 200);

  const quiet = at("2026-10", 11);
  eq("a quiet day carries neither", [quiet.hasIn, quiet.hasOut], [false, false]);
  // ZERO AND NOTHING ARE DIFFERENT SENTENCES. A quiet day has no net
  // rather than a net of 0, so the cell can say nothing instead of
  // printing a number that did not happen.
  eq("...and has no net at all", quiet.net, null);
  eq("a day outside the forecast has none either", at("2026-10", 4).net, null);
}

// ---- the net, which must agree with the balance above it ------------
{
  // DERIVED FROM THE BALANCES EITHER SIDE, not re-added from the rows:
  // two numbers in one cell computed two ways is two numbers that can
  // disagree, and this one sits directly under the other.
  const oct = cells("2026-10").filter(Boolean);
  let mismatches = 0, compared = 0;
  for (let i = 1; i < oct.length; i++) {
    const day = oct[i], prev = oct[i - 1];
    if (day.net == null || prev.balance == null || day.balance == null) continue;
    compared++;
    if (Math.abs((prev.balance + day.net) - day.balance) > 0.005) mismatches++;
  }
  is("there are days to compare", compared > 2);
  eq("every net is exactly the step from the day before", mismatches, 0);
  eq("rent on the 10th is the step it caused", at("2026-10", 10).net, -1500);
  eq("the paycheck on the 16th is its own", at("2026-10", 16).net, 1800);
}

// ---- the net, written out --------------------------------------------
{
  // A TRUE MINUS (U+2212), not a hyphen: it sits beside a plus in a
  // column of tabular figures and has to be its own width.
  eq("money in gets a plus", netAmountFull(1690), "+$1,690");
  eq("money out gets a minus", netAmountFull(-412), "\u2212$412");
  eq("...and the phone drops the dollar sign", netAmountCompact(-412), "\u2212412");
  eq("...and shortens past ten thousand", netAmountCompact(-12345), "\u221212.3k");
  eq("exactly zero is neither up nor down", [netAmountFull(0), netAmountCompact(0)], ["$0", "0"]);
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
