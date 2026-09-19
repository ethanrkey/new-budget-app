import { useState } from "react";
import { computeMonthVariance, lastMonthKeys } from "../engine/progress.js";
import { todayISO } from "../engine/model.js";

const money = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

const CADENCE_LABEL = {
  weekly: "every week",
  biweekly: "every 2 weeks",
  monthly: "monthly",
  yearly: "yearly",
};

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
}

// Actual vs. budgeted for bills (and loans) flagged "Track actual vs.
// budgeted" — moved out of the Dashboard into its own tab in Phase 2. The
// Dashboard is balances + contributions only; this is spending behavior.
// "Now" is the real clock: the window is the last 6 calendar months
// ending in the current month.
export default function SpendingView({ state, onSetMonthlyActual, onDeleteMonthlyActual }) {
  const variableItems = state.recurring.filter((r) => r.variable);
  const monthKeys = lastMonthKeys(todayISO(), 6);

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-lg rounded-tr-lg p-3 sm:p-4">
      <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300">Variable spending</h2>
      <p className="text-xs text-gray-400 mb-4">
        Items flagged &quot;Track actual vs. budgeted&quot; in their edit form — log the real monthly total
        once you know it, independent of any specific date. Clear a field to remove it. This is a
        comparison only: what you log here never changes your Ledger or Budget, which always show
        the rule&apos;s amount.
      </p>
      {variableItems.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          Nothing is flagged for this yet — edit a bill (electric, groceries, gas) or a loan and check
          &quot;Track actual vs. budgeted.&quot;
        </p>
      ) : (
        <div className="space-y-4">
          {variableItems.map((item) => (
            <VariableSpendingRow
              key={item.id}
              item={item}
              monthKeys={monthKeys}
              monthlyActuals={state.monthlyActuals}
              onSet={(monthKey, amount) => onSetMonthlyActual(item.id, monthKey, amount)}
              onDelete={(monthKey) => onDeleteMonthlyActual(item.id, monthKey)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function VariableSpendingRow({ item, monthKeys, monthlyActuals, onSet, onDelete }) {
  // Cadence-aware label — a biweekly/weekly item's `amount` is per
  // occurrence, not a monthly figure, so "budgeted $X/mo" would be wrong.
  const cadenceLabel = CADENCE_LABEL[item.cadence] || item.cadence;
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-3">
      <div className="font-medium mb-2">
        {item.name} <span className="text-gray-400 font-normal text-sm">— budgeted {money(item.amount)} {cadenceLabel}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse w-full">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="py-1 pr-3 font-medium">Month</th>
              <th className="py-1 pr-3 font-medium text-right">Expected</th>
              <th className="py-1 pr-3 font-medium text-right">Actual</th>
              <th className="py-1 font-medium text-right">Delta</th>
            </tr>
          </thead>
          <tbody>
            {monthKeys.map((mk) => (
              <MonthRow key={mk} item={item} monthKey={mk} monthlyActuals={monthlyActuals} onSet={onSet} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthRow({ item, monthKey, monthlyActuals, onSet, onDelete }) {
  const v = computeMonthVariance(item, monthlyActuals, monthKey);
  const [draft, setDraft] = useState(v.actual != null ? String(v.actual) : "");

  function commit() {
    if (draft === "") { onDelete(monthKey); return; }
    if (isNaN(Number(draft))) return;
    onSet(monthKey, Number(draft));
  }

  return (
    <tr className="border-t border-gray-100 dark:border-gray-800/60">
      <td className="py-1.5 pr-3">
        {monthLabel(monthKey)}
        {v.occurrences > 1 && <span className="text-gray-400 text-xs"> ({v.occurrences}×)</span>}
      </td>
      <td className="py-1.5 pr-3 text-right text-gray-500">{money(v.expected)}</td>
      <td className="py-1.5 pr-3 text-right">
        <input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
          placeholder="—"
          className="w-24 px-1.5 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-right"
        />
      </td>
      <td className={`py-1.5 text-right font-medium ${v.delta == null ? "text-gray-300 dark:text-gray-600" : v.delta > 0 ? "text-expense" : v.delta < 0 ? "text-income" : "text-gray-400"}`}>
        {v.delta == null ? "—" : (v.delta > 0 ? "+" : "") + money(v.delta)}
      </td>
    </tr>
  );
}
