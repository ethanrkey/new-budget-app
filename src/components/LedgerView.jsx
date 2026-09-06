import { useState } from "react";
import { groupByMonth } from "../engine/compute.js";
import { todayISO } from "../engine/model.js";
import HorizonSlider from "./HorizonSlider.jsx";

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const CURRENT_MONTH = todayISO().slice(0, 7);

export default function LedgerView({ state, setSettings, ledger, onEditItem, onDeleteItem, onDeleteMany, onTogglePaid }) {
  const showCum = state.settings.showCumulative;
  const groups = groupByMonth(ledger.rows);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);

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

  const colCount = selectMode ? 11 : 10;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-lg rounded-tr-lg p-3 sm:p-4">
      {/* toolbar */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <button
            onClick={() => setSettings({ showCumulative: !showCum })}
            className="px-3 py-2 sm:py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {showCum ? "Hide" : "Show"} savings columns
          </button>
          <HorizonSlider
            label="Project through"
            anchor={state.settings.checkInDate}
            horizon={state.settings.ledgerHorizon}
            onChange={(iso) => setSettings({ ledgerHorizon: iso })}
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
              <th className={`py-2 font-medium text-right slide-col text-roth ${showCum ? "open" : ""}`}>Roth</th>
              <th className={`py-2 font-medium text-right slide-col text-saved ${showCum ? "open" : ""}`}>Saved</th>
              <th className={`py-2 font-medium text-right slide-col text-brokerage ${showCum ? "open" : ""}`}>Broker.</th>
              <th className={`py-2 font-medium text-right slide-col text-loans ${showCum ? "open" : ""}`}>Loans</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FragmentGroup
                key={g.label}
                group={g}
                showCum={showCum}
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
          <div className="text-center text-gray-400 py-12">
            No transactions yet. Add one, or set up recurring items.
          </div>
        )}
      </div>
    </div>
  );
}

function FragmentGroup({ group, showCum, colCount, selectMode, selected, onToggleSelected, onEdit, onDelete, onTogglePaid }) {
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
              {canMarkPaid && (
                <input
                  type="checkbox"
                  checked={!!r.paidOverride}
                  onChange={() => onTogglePaid(r.id, r.date.slice(0, 7))}
                  title="Mark paid this month"
                  className="mr-1.5 align-middle h-4 w-4 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 checked:opacity-100 transition cursor-pointer"
                />
              )}
              {dayOf(r.date)}
            </td>
            <td className={`py-2 sm:py-1.5 pr-3 ${isBill ? "text-bill font-medium" : ""} ${r.paidOverride ? "opacity-40" : ""}`}>
              <button
                onClick={() => onEdit(r.id)}
                className="text-left hover:underline decoration-dotted underline-offset-2"
                title="Edit"
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
            </td>
            <td className={`py-2 sm:py-1.5 pr-3 text-right font-medium ${r.negative ? "text-expense" : ""}`}>
              {money(r.balance)}
            </td>
            <td className={`py-2 sm:py-1.5 text-right slide-col text-roth ${showCum ? "open" : ""}`}>{stepCell(r, "roth")}</td>
            <td className={`py-2 sm:py-1.5 text-right slide-col text-saved ${showCum ? "open" : ""}`}>{stepCell(r, "saved")}</td>
            <td className={`py-2 sm:py-1.5 text-right slide-col text-brokerage ${showCum ? "open" : ""}`}>{stepCell(r, "brokerage")}</td>
            <td className={`py-2 sm:py-1.5 text-right slide-col text-loans ${showCum ? "open" : ""}`}>{stepCell(r, "loans")}</td>
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
