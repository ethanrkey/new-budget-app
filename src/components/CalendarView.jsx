import { useMemo, useState } from "react";
import { todayISO, primaryAccount, ledgerHorizonOf } from "../engine/model.ts";
import {
  calendarMonths, buildCalendarMonth, addMonthKey, cellAmountFull,
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
// NO WARNING COLORS. A negative projected balance is a minus sign and
// nothing else. Tinting the low days turns a map of where the money
// goes into a verdict on it, and the app does not make that call here.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarView({ state, ledger, trackerCategories = [], onEditItem }) {
  const today = todayISO();
  const account = primaryAccount(state);
  const anchor = account.balanceAsOf;
  const horizon = ledgerHorizonOf(state);

  const months = useMemo(
    () => calendarMonths(ledger.rows, anchor, today),
    [ledger.rows, anchor, today],
  );
  // OPENS ON TODAY, AND ON TODAY SELECTED. The old version opened on
  // whichever month the ledger's first row fell in, with nothing
  // picked — so the first thing it showed was a grid you had to
  // navigate before it told you anything.
  const [monthKey, setMonthKey] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);

  const month = useMemo(
    () => buildCalendarMonth(monthKey, ledger.rows, account.balance, anchor, today, horizon),
    [monthKey, ledger.rows, account.balance, anchor, today, horizon],
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
              className={`min-h-[62px] sm:min-h-[84px] rounded-lg border p-1 sm:p-1.5 text-left align-top transition hover:bg-gray-50 dark:hover:bg-gray-800/60 ${
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
                    : "text-gray-500"}`}>
                  {cell.day}
                </span>
                {cell.busy && (
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-500 shrink-0" />
                )}
              </div>
              {/* Neutral, always. See the note at the top of the file. */}
              {cell.balance != null && (
                <div className="mt-1 text-[11px] sm:text-xs tabular-nums leading-none text-gray-600 dark:text-gray-300">
                  {cellAmountFull(cell.balance)}
                </div>
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
  if (cell.rows.length) {
    parts.push(`${cell.rows.length} transaction${cell.rows.length === 1 ? "" : "s"}`);
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
      ) : (
        <p className="mt-1 mb-2 text-xs text-gray-400">
          {cell.date < anchor ? COPY.beforeAnchor(fmtDate(anchor)) : COPY.pastHorizon}
        </p>
      )}

      {cell.rows.length === 0 ? (
        <p className="text-xs text-gray-400">{COPY.quiet}</p>
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
