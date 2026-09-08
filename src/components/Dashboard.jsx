import { useState } from "react";
import { computeCategoryProgress, computeCategoryHistory, computeMonthVariance, computeContributionsByYear, lastMonthKeys } from "../engine/progress.js";
import { computeDebtCategoryProgress, computeDebtCategoryHistory } from "../engine/loans.js";
import { paletteColor, todayISO } from "../engine/model.js";

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

// Reconciles the forecast against reality: actual fund balances you log
// yourself (vs. what the transaction log alone would project), actual vs.
// budgeted for bills flagged "variable" (electric, groceries, gas — amounts
// that are never exact), and amortized debt payoff. Ledger/Budget stay pure
// forecasting tools; this is the only place actuals live.
export default function Dashboard({
  state, isDark,
  onAddSnapshot, onUpdateSnapshot, onDeleteSnapshot,
  onSetMonthlyActual, onDeleteMonthlyActual,
  onEditItem,
}) {
  const sortedCats = [...state.trackerCategories].sort((a, b) => a.order - b.order);
  const variableItems = state.recurring.filter((r) => r.variable);
  const asOf = state.settings.checkInDate;
  const monthKeys = lastMonthKeys(asOf, 6);

  return (
    <div className="space-y-4">
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-b-lg rounded-tr-lg p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300">Fund balances</h2>
        <p className="text-xs text-gray-400 mb-4">
          &quot;Expected&quot; projects your last logged balance forward using every transaction since —
          log a fresh balance any time you check the real account. For a market-exposed account
          (Roth, Brokerage), the gap you see is mostly real growth/loss, not tracking error — that&apos;s
          what &quot;Contributed&quot; is for: a number the market can&apos;t move.
        </p>
        {sortedCats.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            No savings/debt categories yet — add one from ⚙ Categories.
          </p>
        ) : (
          <div className="space-y-3">
            {sortedCats.map((cat) =>
              cat.kind === "debt" ? (
                <DebtCategoryRow
                  key={cat.id}
                  category={cat}
                  isDark={isDark}
                  asOf={asOf}
                  progress={computeDebtCategoryProgress(state, cat.id, asOf)}
                  history={computeDebtCategoryHistory(state, cat.id)}
                  contributionsByYear={computeContributionsByYear(state, cat.id, asOf)}
                  onAddSnapshot={(amount, date) => onAddSnapshot(cat.id, amount, date)}
                  onUpdateSnapshot={(snapshotId, patch) => onUpdateSnapshot(cat.id, snapshotId, patch)}
                  onDeleteSnapshot={(snapshotId) => onDeleteSnapshot(cat.id, snapshotId)}
                  onEditItem={onEditItem}
                />
              ) : (
                <FundBalanceRow
                  key={cat.id}
                  category={cat}
                  isDark={isDark}
                  asOf={asOf}
                  progress={computeCategoryProgress(state, cat.id, asOf)}
                  history={computeCategoryHistory(state, cat.id)}
                  contributionsByYear={computeContributionsByYear(state, cat.id, asOf)}
                  onAddSnapshot={(amount, date) => onAddSnapshot(cat.id, amount, date)}
                  onUpdateSnapshot={(snapshotId, patch) => onUpdateSnapshot(cat.id, snapshotId, patch)}
                  onDeleteSnapshot={(snapshotId) => onDeleteSnapshot(cat.id, snapshotId)}
                />
              )
            )}
          </div>
        )}
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300">Variable spending</h2>
        <p className="text-xs text-gray-400 mb-4">
          Bills flagged &quot;Track actual vs. budgeted&quot; in their edit form — log the real monthly
          total once you know it, independent of any specific date. Clear a field to remove it.
        </p>
        {variableItems.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            No bills are flagged for this yet — edit a bill (electric, groceries, gas) and check
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
    </div>
  );
}

// Shared "log a balance" + history controls, used by both FundBalanceRow and
// DebtCategoryRow — only the header content above it differs.
function BalanceLogControls({ history, onAddSnapshot, onUpdateSnapshot, onDeleteSnapshot }) {
  const [showHistory, setShowHistory] = useState(false);
  const [draftAmount, setDraftAmount] = useState("");
  const [draftDate, setDraftDate] = useState(todayISO());

  function submitNew() {
    if (draftAmount === "" || isNaN(Number(draftAmount))) return;
    onAddSnapshot(Number(draftAmount), draftDate);
    setDraftAmount("");
    setDraftDate(todayISO());
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-2 mt-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Log a balance</label>
          <input
            type="number"
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            placeholder="0.00"
            className="w-28 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
        </div>
        <input
          type="date"
          value={draftDate}
          onChange={(e) => setDraftDate(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
        />
        <button
          onClick={submitNew}
          disabled={draftAmount === ""}
          className="px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium disabled:opacity-40"
        >
          Save
        </button>
        {history.length > 0 && (
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-sm text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 ml-auto"
          >
            {showHistory ? "Hide" : "Show"} history ({history.length})
          </button>
        )}
      </div>

      {showHistory && (
        <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-2">
          {[...history].reverse().map((h) => (
            <HistoryRow
              key={h.id}
              entry={h}
              onUpdate={(patch) => onUpdateSnapshot(h.id, patch)}
              onDelete={() => onDeleteSnapshot(h.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Compact "Contributed/Paid this year" stat + an expandable by-year
// breakdown — a growth-independent number to sit next to Expected/Actual,
// which for a market-exposed account can otherwise look like a tracking
// error when it's really just the market moving.
function ContributionsStat({ label, byYear, currentYear }) {
  const [expanded, setExpanded] = useState(false);
  const years = Object.keys(byYear);
  if (years.length === 0) return null;
  return (
    <span className="text-gray-500">
      {label} {currentYear}:{" "}
      <span className="font-semibold text-gray-800 dark:text-gray-100">{money(byYear[currentYear] || 0)}</span>
      {years.length > 1 && (
        <button onClick={() => setExpanded((v) => !v)} className="ml-1.5 text-xs underline decoration-dotted underline-offset-2 text-gray-400">
          {expanded ? "hide" : "all years"}
        </button>
      )}
      {expanded && (
        <span className="block text-xs mt-1 space-y-0.5">
          {years.map((y) => (
            <span key={y} className="block">
              {y}: {money(byYear[y])}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function FundBalanceRow({ category, isDark, asOf, progress, history, contributionsByYear, onAddSnapshot, onUpdateSnapshot, onDeleteSnapshot }) {
  const color = paletteColor(category.color, isDark);
  // The app's own "now" (checkInDate), NOT the real device clock — same
  // anchor everything else here uses. Using todayISO() instead was a real
  // bug: contributionsByYear is keyed off checkInDate too, so any drift
  // between the two showed "Contributed <wrong year>: $0.00" (easy to
  // mistake for the stat not being there at all).
  const currentYear = asOf.slice(0, 4);

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="font-medium">{category.name}</span>
        </div>
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <span className="text-gray-500">
            Expected now:{" "}
            <span className="font-semibold text-gray-800 dark:text-gray-100">{money(progress.expectedNow)}</span>
          </span>
          <span className="text-gray-500">
            {progress.latest ? (
              <>
                Last logged: <span className="font-semibold" style={{ color }}>{money(progress.latest.amount)}</span>{" "}
                ({progress.latest.date})
              </>
            ) : (
              "No balance logged yet"
            )}
          </span>
          <ContributionsStat label="Contributed" byYear={contributionsByYear} currentYear={currentYear} />
        </div>
      </div>

      <BalanceLogControls history={history} onAddSnapshot={onAddSnapshot} onUpdateSnapshot={onUpdateSnapshot} onDeleteSnapshot={onDeleteSnapshot} />
    </div>
  );
}

// A debt category's "expected" is the sum of every configured loan's own
// amortization schedule (rate + original amount), not a contribution
// cumulative — a payment REDUCES what's owed, it doesn't accumulate.
function DebtCategoryRow({ category, isDark, asOf, progress, history, contributionsByYear, onAddSnapshot, onUpdateSnapshot, onDeleteSnapshot, onEditItem }) {
  const color = paletteColor(category.color, isDark);
  const currentYear = asOf.slice(0, 4); // see FundBalanceRow's comment — same fix

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="font-medium">{category.name}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">Debt</span>
        </div>
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <span className="text-gray-500">
            Expected remaining:{" "}
            <span className="font-semibold text-gray-800 dark:text-gray-100">{money(progress.expectedNow)}</span>
          </span>
          <span className="text-gray-500">
            {progress.latest ? (
              <>
                Last logged: <span className="font-semibold" style={{ color }}>{money(progress.latest.amount)}</span>{" "}
                ({progress.latest.date})
              </>
            ) : (
              "No balance logged yet"
            )}
          </span>
          <ContributionsStat label="Paid" byYear={contributionsByYear} currentYear={currentYear} />
        </div>
      </div>

      {progress.loans.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {progress.loans.map((l) => (
            <span key={l.id}>{l.name}: <span className="font-medium text-gray-700 dark:text-gray-300">{money(l.balance)}</span></span>
          ))}
        </div>
      )}

      {progress.unconfigured.length > 0 && (
        <div className="mt-2 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-lg p-2 text-amber-800 dark:text-amber-300">
          Not counted in the total yet (needs an interest rate + original amount):{" "}
          {progress.unconfigured.map((loan, i) => (
            <span key={loan.id}>
              {i > 0 && ", "}
              {onEditItem ? (
                <button onClick={() => onEditItem(loan.id)} className="underline decoration-dotted underline-offset-2">{loan.name}</button>
              ) : (
                loan.name
              )}
            </span>
          ))}
        </div>
      )}

      <BalanceLogControls history={history} onAddSnapshot={onAddSnapshot} onUpdateSnapshot={onUpdateSnapshot} onDeleteSnapshot={onDeleteSnapshot} />
    </div>
  );
}

function HistoryRow({ entry, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState(entry.amount);
  const [draftDate, setDraftDate] = useState(entry.date);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function commit() {
    if (draftAmount !== "" && !isNaN(Number(draftAmount)) && draftDate) {
      onUpdate({ amount: Number(draftAmount), date: draftDate });
    }
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-2 text-sm py-1 flex-wrap">
      {editing ? (
        <>
          <input
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            className="px-1.5 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs"
          />
          <input
            type="number"
            autoFocus
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
            className="w-24 px-1.5 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs"
          />
          <button onClick={commit} className="text-xs text-income font-medium">Save</button>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-400">Cancel</button>
        </>
      ) : (
        <>
          <span className="text-gray-400 w-24 shrink-0">{entry.date}</span>
          <button
            onClick={() => { setDraftAmount(entry.amount); setDraftDate(entry.date); setEditing(true); }}
            title="Edit"
            className="font-medium hover:underline decoration-dotted underline-offset-2"
          >
            {money(entry.amount)}
          </button>
          <span className={`text-xs ${entry.variance === 0 ? "text-gray-400" : entry.variance > 0 ? "text-income" : "text-expense"}`}>
            (expected {money(entry.expected)}, {entry.variance > 0 ? "+" : ""}{money(entry.variance)})
          </span>
          <span className="ml-auto" />
          {confirmDelete ? (
            <span className="text-xs text-expense whitespace-nowrap">
              <button onClick={onDelete} className="font-semibold underline">Delete</button>
              {" · "}
              <button onClick={() => setConfirmDelete(false)} className="underline">Keep</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} title="Delete" className="text-gray-300 hover:text-expense text-xs px-1">
              ✕
            </button>
          )}
        </>
      )}
    </div>
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
