import { useMemo, useState } from "react";
import { todayISO, primaryAccount, ledgerHorizonOf } from "../engine/model.ts";
import {
  calendarMonths, buildCalendarMonth, addMonthKey, cellAmountFull, netAmountFull,
} from "../engine/calendar.ts";
import { CALENDAR_COPY as COPY } from "../content/calendar.ts";
import { fmtDate, fmtLongDay, fmtMonthYear } from "../shared/dates.ts";

// ---- The Ledger's month-grid rendering ----
//
// REBUILT 2026-10-17 AROUND ONE NUMBER. Every cell used to show the
// day's NET — "+2,400" on payday, "−1,650" on the first — which is
// true and is almost nobody's question. What people open a calendar
// for is where their checking balance LANDS on a given day, and that
// was the one thing a seven-column grid could not say: the running
// balance lived in the list view's column and the grid deliberately
// left it out.
//
// So the running balance is the cell now, the dots are one neutral
// marker meaning "something happens here", and net is gone from the
// grid and from the detail panel alike. The arithmetic is shared with
// the phone in src/engine/calendar.ts, including which days have no
// forecast at all; the words are shared in src/content/calendar.ts.
//
// NO WARNING COLORS. A negative projected BALANCE is a minus sign and
// nothing else. Tinting the low days turns a map of where the money
// goes into a verdict on it, and the app does not make that call here.
//
// The dots and the day's net ARE colored, which is not a reversal of
// that: direction of flow is the same red and green every amount in
// this app already wears, and it is a fact rather than a judgment.
// Identity never rests on color either way — the cell lists the items
// in words, the aria-label says them, and the panel below repeats
// them.
//
// THE WEB CELL CARRIES MORE THAN THE PHONE'S, deliberately. It is
// three times the width and was mostly empty, so it also lists the
// day's first three items by name. The phone's 49pt cell could not
// hold a name and does not try.
//
// PAST DAYS SHOW LOGGED HISTORY AND NOTHING ELSE. The days before the
// anchor could be filled by running the rules backwards; the result
// would be fiction. A rule says what is supposed to happen, the past
// is what did, and the only honest thing to put in a past cell is a
// balance the user actually recorded. It wears a tag saying so.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// FOUR, not three. At three a day with four items spent a line saying
// "+1 more" instead of just showing the fourth — strictly less
// information in the same room.
const ITEM_CAP = 4;

export default function CalendarView({ state, ledger, trackerCategories = [], onEditItem }) {
  const today = todayISO();
  const account = primaryAccount(state);
  const anchor = account.balanceAsOf;
  const horizon = ledgerHorizonOf(state);

  // The checking account's own logged readings — real history, and
  // the only thing a past cell is allowed to show. Memoized because
  // `?? []` is a new array every render, which would rebuild the
  // whole month grid on each one.
  const snapshots = useMemo(
    () => state.accountSnapshots?.[account.id] ?? [],
    [state.accountSnapshots, account.id],
  );
  const months = useMemo(
    () => calendarMonths(ledger.rows, anchor, today, snapshots),
    [ledger.rows, anchor, today, snapshots],
  );
  // OPENS ON TODAY, AND ON TODAY SELECTED. The old version opened on
  // whichever month the ledger's first row fell in, with nothing
  // picked — so the first thing it showed was a grid you had to
  // navigate before it told you anything.
  const [monthKey, setMonthKey] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);

  const month = useMemo(
    () => buildCalendarMonth({
      key: monthKey, rows: ledger.rows, startBalance: account.balance,
      anchor, today, horizon, snapshots,
    }),
    [monthKey, ledger.rows, account.balance, anchor, today, horizon, snapshots],
  );
  const byDate = useMemo(() => {
    const m = new Map();
    for (const c of month.cells) if (c) m.set(c.date, c);
    return m;
  }, [month]);
  const selectedDay = byDate.get(selected) ?? null;

  // THE DOT MEANS "something happened here" AND NOTHING ELSE — one
  // marker, secondary-text gray, since the cell's room went to the
  // balance. Identity lives in the detail panel, in words.
  const catName = (categoryId) =>
    trackerCategories.find((c) => c.id === categoryId)?.name ??
    ({ income: "Income", bill: "Fixed bill", oneoff: "One-off" }[categoryId] ?? "Uncategorized");

  const first = months[0] ?? monthKey;
  const last = months[months.length - 1] ?? monthKey;

  function goMonth(n) {
    const next = addMonthKey(monthKey, n);
    setMonthKey(next);
    // Follow the month rather than clearing: an empty panel under a
    // grid you have just paged into is a worse answer than the 1st's.
    setSelected(`${next}-01`);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <button
          onClick={() => goMonth(-1)}
          disabled={monthKey <= first}
          className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-30"
          aria-label="Previous month"
        >←</button>
        <div className="font-medium text-sm">{fmtMonthYear(monthKey)}</div>
        <button
          onClick={() => goMonth(1)}
          disabled={monthKey >= last}
          className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-30"
          aria-label="Next month"
        >→</button>
      </div>

      <div className="grid grid-cols-7 gap-px text-center text-[11px] font-medium text-gray-500 mb-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            <span className="sm:hidden">{d[0]}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {month.cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} />;
          const isSelected = cell.date === selected;
          return (
            <button
              key={cell.date}
              onClick={() => setSelected(cell.date)}
              aria-label={ariaFor(cell)}
              aria-current={cell.isToday ? "date" : undefined}
              className={`min-h-[62px] sm:min-h-[132px] rounded-lg border p-1 sm:p-1.5 text-left align-top transition hover:bg-gray-50 dark:hover:bg-gray-800/60 ${
                isSelected
                  ? "border-gray-900 dark:border-gray-100"
                  : "border-gray-200 dark:border-gray-800"
              } ${cell.dim ? "opacity-40" : ""}`}
            >
              {/* TODAY AND THE SELECTED DAY ARE DIFFERENT MARKS and must
                  stay different: selection is a border round the cell,
                  today is a bold number with a rule under it. The old
                  grid bolded today and outlined the selection in the
                  same gray, which read as one state in two halves. */}
              <div className="flex items-baseline gap-1 leading-none mb-1">
                <span className={`text-[11px] ${
                  cell.isToday
                    ? "font-bold text-gray-900 dark:text-gray-100 border-b-2 border-gray-900 dark:border-gray-100 pb-0.5"
                    : "text-gray-400"}`}>
                  {cell.day}
                </span>
                {/* One dot per direction: red out, green in, both on a
                    payday that also pays a bill. */}
                {cell.hasOut && <span className="h-1.5 w-1.5 rounded-full bg-expense shrink-0" />}
                {cell.hasIn && <span className="h-1.5 w-1.5 rounded-full bg-income shrink-0" />}
              </div>
              {/* The number you came for, so it is the one in ink —
                  on every day it exists, busy or quiet. It was dimmer
                  on quiet days for one round and that read as two
                  kinds of balance; the dots and the +/- line are what
                  tell a quiet day from a busy one. */}
              {cell.balance != null && (
                <div className="text-[11px] sm:text-xs tabular-nums leading-none font-medium text-gray-900 dark:text-gray-100">
                  {cellAmountFull(cell.balance)}
                </div>
              )}
              {/* A past day the user recorded a balance on. JUST THE
                  NUMBER, like every other cell — the distinction
                  lives one click away in the panel, and in the
                  aria-label for anyone who cannot see the grid. */}
              {cell.balance == null && cell.logged != null && (
                <div className="text-[11px] sm:text-xs tabular-nums leading-none font-medium text-gray-900 dark:text-gray-100">
                  {cellAmountFull(cell.logged)}
                </div>
              )}
              {cell.net != null && (
                <div className={`mt-0.5 text-[10px] tabular-nums leading-none ${
                  cell.net < 0 ? "text-expense" : "text-income"}`}>
                  {netAmountFull(cell.net)}
                </div>
              )}
              {/* The room the phone does not have, used for the thing
                  that otherwise needs a click. */}
              {cell.rows.length > 0 && (
                <ul className="mt-1.5 hidden sm:block space-y-0.5">
                  {cell.rows.slice(0, ITEM_CAP).map((r) => (
                    <li key={r.id} className="flex items-baseline justify-between gap-1 text-[10px] leading-tight">
                      <span className="truncate text-gray-500 dark:text-gray-400">{r.name}</span>
                      <span className={`shrink-0 tabular-nums ${r.direction === "in" ? "text-income" : "text-expense"}`}>
                        {netAmountFull(r.direction === "in" ? r.amount : -r.amount)}
                      </span>
                    </li>
                  ))}
                  {cell.rows.length > ITEM_CAP && (
                    <li className="text-[10px] leading-tight text-gray-400">
                      +{cell.rows.length - ITEM_CAP} more
                    </li>
                  )}
                </ul>
              )}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <DayDetail
          cell={selectedDay}
          anchor={anchor}
          catName={catName}
          onEditItem={onEditItem}
        />
      )}
    </div>
  );
}

/** What a screen reader hears, which is the whole cell in words. */
function ariaFor(cell) {
  const parts = [fmtLongDay(cell.date)];
  if (cell.isToday) parts.push("today");
  if (cell.balance != null) parts.push(`${COPY.balanceAfter} ${cellAmountFull(cell.balance)}`);
  else if (cell.logged != null) parts.push(`${COPY.loggedBalance} ${cellAmountFull(cell.logged)}`);
  if (cell.net != null) parts.push(`${cell.net < 0 ? "down" : "up"} ${cellAmountFull(Math.abs(cell.net))}`);
  if (cell.rows.length) {
    parts.push(`${cell.rows.length} transaction${cell.rows.length === 1 ? "" : "s"}`);
    // THE DOTS' MEANING, IN WORDS. They are the one mark here that
    // carries information by color alone.
    if (cell.hasIn) parts.push("money in");
    if (cell.hasOut) parts.push("money out");
  }
  return parts.join(", ");
}

function DayDetail({ cell, anchor, catName, onEditItem }) {
  return (
    <div className="mt-3 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
      <h3 className="text-sm font-medium">{fmtLongDay(cell.date)}</h3>

      {/* THE HEADLINE, not a footnote. This replaced "net $X", which
          answered a question about the day in isolation; this one
          answers the question the day was opened for. */}
      {cell.balance != null ? (
        <p className="mt-1 mb-2 tabular-nums">
          <span className="text-xs text-gray-500">{COPY.balanceAfter}</span>{" "}
          <span className="text-lg font-semibold">{money(cell.balance)}</span>
        </p>
      ) : cell.logged != null ? (
        // A DIFFERENT SENTENCE, not the same one about a different
        // number: this is what was recorded, not what is projected.
        <p className="mt-1 mb-2 tabular-nums">
          <span className="text-xs text-gray-500">{COPY.loggedBalance}</span>{" "}
          <span className="text-lg font-semibold">{money(cell.logged)}</span>
        </p>
      ) : (
        <p className="mt-1 mb-2 text-xs text-gray-400">
          {cell.date < anchor ? COPY.beforeAnchor(fmtDate(anchor)) : COPY.pastHorizon}
        </p>
      )}

      {cell.rows.length === 0 ? (
        <p className="text-xs text-gray-400">
          {cell.outsideForecast ? "" : COPY.quiet}
        </p>
      ) : (
        <ul className="space-y-1">
          {cell.rows.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onEditItem(r.id)}
                className="w-full flex items-baseline justify-between gap-3 text-sm text-left rounded-md px-1 -mx-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <span className="flex items-baseline gap-2 min-w-0">
                  <span className="truncate text-gray-700 dark:text-gray-300">{r.name}</span>
                  {r.overridden && <span className="text-xs text-gray-400 shrink-0">· edited</span>}
                  <span className="text-xs text-gray-400 shrink-0">{catName(r.category)}</span>
                </span>
                <span className={`shrink-0 tabular-nums ${r.direction === "in" ? "text-income" : "text-expense"}`}>
                  {r.direction === "in" ? "+" : "−"}{money(r.amount)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
