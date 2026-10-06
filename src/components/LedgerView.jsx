import { useState } from "react";
import { groupByMonth, computeSpendingByCategory } from "../engine/compute.ts";
import { todayISO, ledgerHorizonOf, LEDGER_MAX_MONTHS } from "../engine/model.ts";
import { roleOfCategory, isRetainedOutflow } from "../engine/palette.ts";
import HorizonSlider from "./HorizonSlider.jsx";
import InfoTip from "./InfoTip.jsx";
import SpendingMix from "./SpendingMix.jsx";
import CalendarView from "./CalendarView.jsx";
import { getDeviceFlag, setDeviceFlag } from "../devicePrefs.js";

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });


// List vs calendar is a display preference: per device, never synced.
const CALENDAR_PREF = "ledger-calendar";

// How wide a savings/debt column opens to. The column has to be nowrap +
// overflow:hidden so it can animate open from zero width, which means a
// header longer than the fixed width was SILENTLY CLIPPED — "Student Loan AA"
// and "Student Loan AB" both rendered as "Student Loan", so the two columns
// were impossible to tell apart. Size the column to its own header (ch is a
// slightly generous proxy for average character width) with the old 6.5rem as
// the floor so short names still line their amounts up. Both the th and every
// td must carry it — a td's max-width would otherwise cap the whole column.
const colVars = (name) => ({ "--col-w": `max(6.5rem, calc(${(name || "").length}ch + 1.75rem))` });

export default function LedgerView({
  state, setSettings, ledger, trackerCategories = [], isDark,
  onEditItem, onDeleteItem, onDeleteMany, onOpenOnboarding, onOpenCategoryManager,
}) {
  const sortedCats = [...trackerCategories].sort((a, b) => a.order - b.order);
  const visibleIds = new Set(state.settings.visibleTrackerCategoryIds || []);
  const groups = groupByMonth(ledger.rows);

  // A COLUMN FOR A CATEGORY WITH NOTHING SCHEDULED IS AN EMPTY COLUMN. The
  // picker used to list every category you own, which on an account with
  // fourteen of them is thirteen ways to widen the table and learn nothing.
  // Offer only the ones this window actually steps — plus any already
  // switched on, so a category whose last transaction just fell out of the
  // horizon cannot vanish from the list while its column is still open and
  // leave no way to turn it off.
  const steppedIds = new Set(ledger.rows.map((r) => r.stepped?.key).filter(Boolean));
  const offerableCats = sortedCats.filter((c) => steppedIds.has(c.id) || visibleIds.has(c.id));
  const hiddenCount = sortedCats.length - offerableCats.length;

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [calendar, setCalendarState] = useState(() => getDeviceFlag(CALENDAR_PREF, false));
  const setCalendar = (next) => { setDeviceFlag(CALENDAR_PREF, next); setCalendarState(next); };

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelected(new Set());
    setConfirming(false);
  }
  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function confirmDeleteSelected() {
    onDeleteMany([...selected]);
    setSelected(new Set());
    setConfirming(false);
  }
  function toggleColumnVisible(id) {
    const next = visibleIds.has(id)
      ? [...visibleIds].filter((x) => x !== id)
      : [...visibleIds, id];
    setSettings({ visibleTrackerCategoryIds: next });
  }

  const colCount = 6 + sortedCats.length + (selectMode ? 1 : 0);
  const anyOpen = sortedCats.some((c) => visibleIds.has(c.id));

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 sm:p-4">
      {/* toolbar */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <div className="flex items-center gap-1" role="group" aria-label="Ledger layout">
            {[["List", false], ["Calendar", true]].map(([label, val]) => (
              <button
                key={label}
                onClick={() => setCalendar(val)}
                aria-pressed={calendar === val}
                className={`text-sm px-2.5 py-2 sm:py-1.5 rounded-lg transition ${
                  calendar === val
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium"
                    : "border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <HorizonSlider
            label="Project through"
            anchor={todayISO()}
            horizon={ledgerHorizonOf(state)}
            maxMonths={LEDGER_MAX_MONTHS}
            onChange={(iso) => setSettings({ ledgerHorizon: iso })}
            help="How far into the future the Ledger generates transactions. Independent from the Budget's own horizon — you can project the Ledger further (or less far) than the Budget."
          />
        </div>
        <div className={`flex items-center gap-2 flex-wrap ${calendar ? "hidden" : ""}`}>
          <button
            onClick={toggleSelectMode}
            className="px-3 py-2 sm:py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {selectMode ? "Cancel select" : "Select"}
          </button>
          {selectMode && selected.size > 0 && (
            confirming ? (
              <span className="text-sm text-expense">
                Delete {selected.size} item{selected.size === 1 ? "" : "s"}?{" "}
                <button onClick={confirmDeleteSelected} className="font-semibold underline">Yes, delete</button>
                {" · "}
                <button onClick={() => setConfirming(false)} className="underline">Keep</button>
              </span>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="px-3 py-2 sm:py-1.5 rounded-lg bg-expense text-white text-sm font-medium hover:opacity-90"
              >
                Delete selected ({selected.size})
              </button>
            )
          )}
          <div className="text-sm text-gray-500">
            Ending balance:{" "}
            <span className={ledger.endingBalance < 0 ? "text-expense font-semibold" : "font-semibold"}>
              {money(ledger.endingBalance)}
            </span>
          </div>
        </div>
      </div>

      {/* Forecast-only breakdown of this same window. Sits above the table
          and collapsed by default: the Ledger's job is the transaction list,
          and on a phone a permanent chart pushes the first row off-screen. */}
      <SpendingMix mix={computeSpendingByCategory(state, ledgerHorizonOf(state))} isDark={isDark} />

      {calendar ? (
        <CalendarView
          ledger={ledger}
          trackerCategories={trackerCategories}
          onEditItem={onEditItem}
        />
      ) : (
      <>
      {/* Sits with the table it affects, not up in the toolbar: savings
          columns do nothing to the Planned spending panel above, and placing
          the control over that panel implied a relationship that isn't
          there. The horizon slider stays in the toolbar — it DOES drive
          both. */}
      {!calendar && (
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap mb-3">
          <div className={`relative ${calendar ? "hidden" : ""}`}>
          <button
            onClick={() => setColumnsOpen((v) => !v)}
            className="px-3 py-2 sm:py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Cumulative columns{anyOpen ? ` (${[...visibleIds].length})` : ""} ▾
          </button>
          {columnsOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setColumnsOpen(false)} />
              <div className="absolute left-0 mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-20 p-2">
                {offerableCats.length === 0 ? (
                  <p className="text-xs text-gray-400 px-2 py-1.5">
                    {sortedCats.length === 0
                      ? "No categories yet."
                      : "Nothing in this window is tagged to one of your categories, so every column would be empty."}
                  </p>
                ) : (
                  offerableCats.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={visibleIds.has(c.id)}
                        onChange={() => toggleColumnVisible(c.id)}
                        className="h-4 w-4"
                      />
                      <span className="truncate">{c.name}</span>
                    </label>
                  ))
                )}
                {hiddenCount > 0 && (
                  <p className="text-[11px] text-gray-400 px-2 pt-1.5 border-t border-gray-100 dark:border-gray-800 mt-1">
                    {hiddenCount} more {hiddenCount === 1 ? "category has" : "categories have"} nothing
                    scheduled in this window.
                  </p>
                )}
                {onOpenCategoryManager && (
                  <button
                    onClick={() => { setColumnsOpen(false); onOpenCategoryManager(); }}
                    className="mt-1 w-full text-left px-2 py-1.5 rounded text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 border-t border-gray-100 dark:border-gray-800"
                  >
                    ⚙ Manage categories…
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <InfoTip text="Running totals for your own savings/debt/investment categories — each column adds up every transaction in that category over time, so you can see the balance build (or pay down) as you go. Pick which ones show here." />
        </div>
      )}
      {/* table — scrolls horizontally on narrow screens */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-800">
              {selectMode && <th className="py-2 pr-1 font-medium w-6"></th>}
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 pr-3 font-medium text-right">In</th>
              <th className="py-2 pr-3 font-medium text-right">Out</th>
              <th className="py-2 pr-3 font-medium text-right">Balance</th>
              {sortedCats.map((c) => (
                <th
                  key={c.id}
                  className={`py-2 font-medium text-right slide-col ${visibleIds.has(c.id) ? "open" : ""}`}
                  style={colVars(c.name)}
                >
                  {c.name}
                </th>
              ))}
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FragmentGroup
                key={g.label}
                group={g}
                sortedCats={sortedCats}
                visibleIds={visibleIds}
                colCount={colCount}
                selectMode={selectMode}
                selected={selected}
                onToggleSelected={toggleSelected}
                onEdit={onEditItem}
                onDelete={(id) => onDeleteItem(baseId(id))}
              />
            ))}
          </tbody>
        </table>
        {ledger.rows.length === 0 && (
          <div className="text-center py-12 px-4">
            <p className="text-gray-500 dark:text-gray-400 max-w-sm mx-auto text-sm">
              The Ledger is your day-by-day transaction log — every paycheck and bill, in order, with a
              running balance. Nothing has been added yet: a <strong>one-off</strong> is a single
              transaction (a gift, a repair), while a <strong>recurring rule</strong> (rent, a paycheck,
              a subscription) generates its own dated transactions automatically, every month or pay
              period, from here forward.
            </p>
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={onOpenOnboarding}
                className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium hover:opacity-90"
              >
                Run setup wizard
              </button>
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

function FragmentGroup({ group, sortedCats, visibleIds, colCount, selectMode, selected, onToggleSelected, onEdit, onDelete }) {
  return (
    <>
      <tr className="bg-gray-50 dark:bg-gray-850">
        <td colSpan={colCount} className="py-1.5 px-1 font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800">
          {group.label}
        </td>
      </tr>
      {group.rows.map((r) => {
        const itemId = baseId(r.id);
        // Role no longer picks a colour — it picks whether the amount is
        // red. A transfer to savings, a contribution and a loan payment all
        // leave the account and none of them is money gone, so they print
        // plain. The Budget has done this since 2026-10-03 and the Ledger
        // reddened the same $300 until 2026-10-06; one rule, one place.
        const retained = r.direction === "out" && isRetainedOutflow(roleOfCategory(r.category, sortedCats));
        return (
          <tr
            key={r.id}
            className="border-b border-gray-100 dark:border-gray-800/60 group hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
          >
            {selectMode && (
              <td className="py-2 sm:py-1.5 pr-1">
                <input
                  type="checkbox"
                  checked={selected.has(itemId)}
                  onChange={() => onToggleSelected(itemId)}
                  className="h-4 w-4 cursor-pointer"
                />
              </td>
            )}
            <td className="py-2 sm:py-1.5 pr-3 text-gray-500 whitespace-nowrap">
              {dayOf(r.date)}
            </td>
            <td className="py-2 sm:py-1.5 pr-3">
              <button
                onClick={() => onEdit(r.id)}
                className="text-left hover:underline decoration-dotted underline-offset-2"
                title="Edit"
              >
                {r.name}
              </button>
              {/* An amount that disagrees with its own rule looks like a bug
                  without this. It marks FORECAST data the user set on
                  purpose, not an observation. */}
              {r.overridden && (
                <span className="ml-1.5 text-xs text-gray-400" title="This date has its own amount">· edited</span>
              )}
            </td>
            <td className="py-2 sm:py-1.5 pr-3 text-right text-income">
              {r.direction === "in" ? money(r.amount) : ""}
            </td>
            <td className={`py-2 sm:py-1.5 pr-3 text-right ${retained ? "" : "text-expense"}`}>
              {r.direction === "out" ? money(r.amount) : ""}
            </td>
            <td className={`py-2 sm:py-1.5 pr-3 text-right font-medium ${r.negative ? "text-expense" : ""}`}>
              {money(r.balance)}
            </td>
            {sortedCats.map((c) => (
              <td
                key={c.id}
                className={`py-2 sm:py-1.5 text-right slide-col ${visibleIds.has(c.id) ? "open" : ""}`}
                style={colVars(c.name)}
              >
                {stepCell(r, c.id)}
              </td>
            ))}
            <td className="py-2 sm:py-1.5 text-right">
              <button
                onClick={() => onDelete(r.id)}
                className="text-gray-300 hover:text-expense opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition text-sm sm:text-xs px-1.5 py-1 -m-1"
                title="Delete"
              >
                ✕
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function stepCell(r, key) {
  if (r.stepped && r.stepped.key === key) return money(r.stepped.value);
  return "";
}
function dayOf(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}
// A ledger row id is "<itemId>@<date>". DELETE strips the date because it
// removes the whole rule; EDIT must NOT, because the date is what lets the
// form offer "This date" as a scope. Stripping it here was the bug that let
// a single-month edit rewrite every month (2026-10-02).
function baseId(id) { return id.split("@")[0]; }
