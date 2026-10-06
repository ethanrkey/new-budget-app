import { useState } from "react";
import { groupByDay } from "../engine/compute.ts";
import { todayISO, toISODate } from "../engine/model.ts";

// ---- The Ledger's month-grid rendering ----
// Same rows as the list, arranged by date. The running balance is
// deliberately absent: a 7-column grid has nowhere to put it, and it is the
// list's whole reason for existing — faking it here would make two views
// disagree about the app's most important number.
//
// Dots show that something happened and roughly what kind. They are NOT
// asked to carry identity: a 6px circle can't hold a label, so per
// PROJECT_SPEC's colour rule every dot's category and amount are reachable
// as text — a title/aria-label on hover, and the day detail on click.
const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Overflow is CAPPED rather than wrapped. Cells in a grid row share a
// height, so wrapping a busy day makes the whole ROW taller and gives its
// quiet neighbours whitespace — it flattens the contrast between busy and
// quiet days instead of sharpening it. "+2" is text, reads at any size, and
// says "more here than fits" more loudly than a fifth dot would.
const DOT_CAP = { narrow: 3, wide: 5 };

const monthKeyOf = (iso) => iso.slice(0, 7);
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}
function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// Every cell of the month grid, padded to whole weeks. Leading/trailing
// blanks are null so the grid keeps its 7-column shape.
function monthCells(key) {
  const [y, m] = key.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toISODate(new Date(y, m - 1, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function CalendarView({ ledger, trackerCategories = [], onEditItem }) {
  const days = groupByDay(ledger.rows);
  const dated = [...days.keys()].sort();
  const today = todayISO();
  // Open on the month the ledger actually starts in, so the first screen is
  // never an empty grid.
  const [monthKey, setMonthKey] = useState(() => monthKeyOf(dated[0] ?? today));
  const [selected, setSelected] = useState(null);

  // THE DOTS MEAN "something happened here" AND NOTHING ELSE. They were
  // role-coloured until 2026-10-06; now they are secondary-text grey, like
  // every other mark that is a count rather than a claim. A month grid is
  // read for density — busy weeks against quiet ones — and seven hues
  // scattered through it competed with exactly that. The day detail names
  // the category in words, which is where identity lives.
  const catName = (categoryId) =>
    trackerCategories.find((c) => c.id === categoryId)?.name ??
    ({ income: "Income", bill: "Fixed bill", oneoff: "One-off" }[categoryId] ?? "Uncategorized");

  const first = dated[0] ? monthKeyOf(dated[0]) : monthKey;
  const last = dated.length ? monthKeyOf(dated[dated.length - 1]) : monthKey;
  const cells = monthCells(monthKey);
  const selectedDay = selected ? days.get(selected) : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <button
          onClick={() => setMonthKey(addMonths(monthKey, -1))}
          disabled={monthKey <= first}
          className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-30"
          aria-label="Previous month"
        >←</button>
        <div className="font-medium text-sm">{monthLabel(monthKey)}</div>
        <button
          onClick={() => setMonthKey(addMonths(monthKey, 1))}
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
        {cells.map((iso, i) => {
          if (!iso) return <div key={`pad-${i}`} />;
          const day = days.get(iso);
          const isToday = iso === today;
          const isSelected = iso === selected;
          return (
            <button
              key={iso}
              onClick={() => setSelected(isSelected ? null : iso)}
              disabled={!day}
              aria-label={day
                ? `${iso}, ${day.rows.length} transaction${day.rows.length === 1 ? "" : "s"}, net ${money(day.net)}`
                : iso}
              className={`min-h-[62px] sm:min-h-[84px] rounded-lg border p-1 sm:p-1.5 text-left align-top transition ${
                isSelected
                  ? "border-gray-900 dark:border-gray-100"
                  : "border-gray-200 dark:border-gray-800"
              } ${day ? "hover:bg-gray-50 dark:hover:bg-gray-800/60" : "opacity-50 cursor-default"}`}
            >
              <div className={`text-[11px] leading-none mb-1 ${isToday ? "font-bold text-gray-900 dark:text-gray-100" : "text-gray-500"}`}>
                {Number(iso.slice(8, 10))}
              </div>
              {day && (
                <>
                  <Dots day={day} catName={catName} />
                  {/* Net is text, never colour — and it is dropped below sm,
                      where "-$1,650.00" simply does not fit a ~52px cell. */}
                  <div className={`hidden sm:block mt-1 text-[11px] tabular-nums leading-none ${
                    day.net < 0 ? "text-expense" : day.net > 0 ? "text-income" : "text-gray-400"}`}>
                    {day.net === 0 ? "—" : money(day.net)}
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <DayDetail
          day={selectedDay}
          catName={catName}
          onEditItem={onEditItem}
          onClose={() => setSelected(null)}
        />
      )}
      {!selected && (
        <p className="mt-3 text-xs text-gray-400">
          Pick a day to see its transactions. The running balance stays in the list view.
        </p>
      )}
    </div>
  );
}

function Dots({ day, catName }) {
  const n = day.rows.length;
  // Rendered ONCE. The extra dots are hidden by CSS below sm rather than
  // rendered twice — two breakpoint copies would make a screen reader
  // announce every transaction on the day twice.
  return (
    <div className="flex flex-wrap items-center gap-1">
      {day.rows.slice(0, DOT_CAP.wide).map((r, i) => (
        <span
          key={r.id}
          title={`${catName(r.category)} · ${r.name} · ${money(r.amount)}`}
          className={`h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-500 ${
            i >= DOT_CAP.narrow ? "hidden sm:inline-block" : "inline-block"
          }`}
        />
      ))}
      {n > DOT_CAP.narrow && (
        <span className="sm:hidden text-[10px] leading-none text-gray-500 font-medium">+{n - DOT_CAP.narrow}</span>
      )}
      {n > DOT_CAP.wide && (
        <span className="hidden sm:inline text-[10px] leading-none text-gray-500 font-medium">+{n - DOT_CAP.wide}</span>
      )}
    </div>
  );
}

function DayDetail({ day, catName, onEditItem, onClose }) {
  const pretty = new Date(day.date + "T00:00:00").toLocaleString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  return (
    <div className="mt-3 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="text-sm font-medium">{pretty}</h3>
        <div className="flex items-baseline gap-3">
          <span className={`text-sm tabular-nums ${day.net < 0 ? "text-expense" : day.net > 0 ? "text-income" : "text-gray-400"}`}>
            net {money(day.net)}
          </span>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Close</button>
        </div>
      </div>
      <ul className="space-y-1">
        {day.rows.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onEditItem(r.id)}
              className="w-full flex items-baseline justify-between gap-3 text-sm text-left rounded-md px-1 -mx-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <span className="flex items-baseline gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full shrink-0 self-center bg-gray-400 dark:bg-gray-500" />
                <span className="truncate text-gray-700 dark:text-gray-300">{r.name}</span>
                {r.overridden && <span className="text-xs text-gray-400 shrink-0">· edited</span>}
                {/* The dot's meaning, in words — the relief the colour rule asks for. */}
                <span className="text-xs text-gray-400 shrink-0">{catName(r.category)}</span>
              </span>
              <span className={`shrink-0 tabular-nums ${r.direction === "in" ? "text-income" : "text-expense"}`}>
                {r.direction === "in" ? "+" : "−"}{money(r.amount)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
