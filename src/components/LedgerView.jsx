import { useState } from "react";
import { groupByMonth } from "../engine/compute.js";
import { todayISO, paletteColor } from "../engine/model.js";
import HorizonSlider from "./HorizonSlider.jsx";
import InfoTip from "./InfoTip.jsx";

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const CURRENT_MONTH = todayISO().slice(0, 7);

export default function LedgerView({
  state, setSettings, ledger, trackerCategories = [], isDark,
  onEditItem, onDeleteItem, onDeleteMany, onTogglePaid, onOpenOnboarding, onOpenCategoryManager,
}) {
  const sortedCats = [...trackerCategories].sort((a, b) => a.order - b.order);
  const visibleIds = new Set(state.settings.visibleTrackerCategoryIds || []);
  const groups = groupByMonth(ledger.rows);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

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
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-lg rounded-tr-lg p-3 sm:p-4">
      {/* toolbar */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <div className="relative">
            <button
              onClick={() => setColumnsOpen((v) => !v)}
              className="px-3 py-2 sm:py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Savings columns{anyOpen ? ` (${[...visibleIds].length})` : ""} ▾
            </button>
            {columnsOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColumnsOpen(false)} />
                <div className="absolute left-0 mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-20 p-2">
                  {sortedCats.length === 0 ? (
                    <p className="text-xs text-gray-400 px-2 py-1.5">No categories yet.</p>
                  ) : (
                    sortedCats.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={visibleIds.has(c.id)}
                          onChange={() => toggleColumnVisible(c.id)}
                          className="h-4 w-4"
                        />
                        <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: paletteColor(c.color, isDark) }} />
                        <span className="truncate">{c.name}</span>
                      </label>
                    ))
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
          <HorizonSlider
            label="Project through"
            anchor={todayISO()}
            horizon={state.settings.ledgerHorizon}
            onChange={(iso) => setSettings({ ledgerHorizon: iso })}
            help="How far into the future the Ledger generates transactions. Independent from the Budget's own horizon — you can project the Ledger further (or less far) than the Budget."
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
                  style={{ color: paletteColor(c.color, isDark) }}
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
                isDark={isDark}
                colCount={colCount}
                selectMode={selectMode}
                selected={selected}
                onToggleSelected={toggleSelected}
                onEdit={(id) => onEditItem(baseId(id))}
                onDelete={(id) => onDeleteItem(baseId(id))}
                onTogglePaid={(id, monthKey) => onTogglePaid(baseId(id), monthKey)}
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
    </div>
  );
}

function FragmentGroup({ group, sortedCats, visibleIds, isDark, colCount, selectMode, selected, onToggleSelected, onEdit, onDelete, onTogglePaid }) {
  return (
    <>
      <tr className="bg-gray-50 dark:bg-gray-850">
        <td colSpan={colCount} className="py-1.5 px-1 font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800">
          {group.label}
        </td>
      </tr>
      {group.rows.map((r) => {
        const isBill = r.category === "bill";
        const canMarkPaid = isBill && r.date.slice(0, 7) === CURRENT_MONTH;
        const itemId = baseId(r.id);
        // an optional per-item color override (recurring items/bills too, not
        // just tracker categories) beats the default bill-purple/plain text
        const nameStyle = r.color != null ? { color: paletteColor(r.color, isDark) } : undefined;
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
              {/* Fixed-width slot on EVERY row (empty when not applicable) so
                  the date text starts at the same x on paid-eligible and
                  ordinary rows alike — the checkbox used to be rendered
                  inline only on eligible rows, shifting those dates right. */}
              <span className="inline-block w-5 mr-1 align-middle">
                {canMarkPaid && (
                  <input
                    type="checkbox"
                    checked={!!r.paidOverride}
                    onChange={() => onTogglePaid(r.id, r.date.slice(0, 7))}
                    title="Mark paid this month"
                    className="align-middle h-4 w-4 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 checked:opacity-100 transition cursor-pointer"
                  />
                )}
              </span>
              {dayOf(r.date)}
            </td>
            <td className={`py-2 sm:py-1.5 pr-3 ${r.paidOverride ? "opacity-40" : ""}`}>
              <button
                onClick={() => onEdit(r.id)}
                className="text-left hover:underline decoration-dotted underline-offset-2"
                title="Edit"
                style={nameStyle}
              >
                {r.name}
              </button>
              {r.paidOverride && <span className="ml-1.5 text-xs text-gray-400">· paid</span>}
            </td>
            <td className="py-2 sm:py-1.5 pr-3 text-right text-income">
              {r.direction === "in" ? money(r.amount) : ""}
            </td>
            <td className={`py-2 sm:py-1.5 pr-3 text-right text-expense ${r.paidOverride ? "line-through opacity-40" : ""}`}>
              {r.direction === "out" ? money(r.amount) : ""}
              {r.isActual && (
                <span title="Uses a logged actual amount, not the budgeted estimate (Dashboard)" className="ml-1 text-gray-400">•</span>
              )}
            </td>
            <td className={`py-2 sm:py-1.5 pr-3 text-right font-medium ${r.negative ? "text-expense" : ""}`}>
              {money(r.balance)}
            </td>
            {sortedCats.map((c) => (
              <td
                key={c.id}
                className={`py-2 sm:py-1.5 text-right slide-col ${visibleIds.has(c.id) ? "open" : ""}`}
                style={{ color: paletteColor(c.color, isDark) }}
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
function baseId(id) { return id.split("@")[0]; }
