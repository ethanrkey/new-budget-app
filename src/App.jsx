import { useState, useEffect, useMemo } from "react";
import { loadState, saveState } from "./storage.js";
import { computeLedger, computeBudget } from "./engine/compute.js";
import { upsertItem, deleteItem, findItem, itemsByName, swapOrder, togglePaidOverride } from "./engine/mutate.js";
import LedgerView from "./components/LedgerView.jsx";
import BudgetView from "./components/BudgetView.jsx";
import EventForm from "./components/EventForm.jsx";

export default function App() {
  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState("ledger");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // raw rule/one-off being edited

  const formOpen = adding || editing != null;
  const closeForm = () => { setAdding(false); setEditing(null); };

  // create or update, then close the form
  function saveItem(evt) {
    setState((s) => upsertItem(s, evt));
    closeForm();
  }
  function removeItem(id) {
    setState((s) => deleteItem(s, id));
    closeForm();
  }

  // open the edit form for a ledger row id ("<itemId>@<date>") or bare item id
  function editById(id) {
    const it = findItem(state, id.split("@")[0]);
    if (it) setEditing(it);
  }
  // open the edit form from a Budget row name — only when it maps to exactly one item
  function editByName(name) {
    const matches = itemsByName(state, name);
    if (matches.length === 1) setEditing(matches[0]);
  }
  function reorderNames(nameA, nameB) {
    setState((s) => swapOrder(s, nameA, nameB));
  }
  function togglePaid(itemId, monthKey) {
    setState((s) => togglePaidOverride(s, itemId, monthKey));
  }

  // persist on every change
  useEffect(() => { saveState(state); }, [state]);

  // apply dark mode class to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (state.settings.theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [state.settings.theme]);

  const setSettings = (patch) =>
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  // computed views (recompute whenever state changes)
  const ledger = useMemo(
    () => computeLedger(state, state.settings.ledgerHorizon),
    [state]
  );
  const budget = useMemo(
    () => computeBudget(state, state.settings.budgetHorizon),
    [state]
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Budget</h1>
        <button
          onClick={() =>
            setSettings({ theme: state.settings.theme === "dark" ? "light" : "dark" })
          }
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
        >
          {state.settings.theme === "dark" ? "☀ Light" : "🌙 Dark"}
        </button>
      </header>

      {/* Check-in bar */}
      <div className="px-6 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/40 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">Current TD balance:</span>
        <span className="text-gray-500">$</span>
        <input
          type="number"
          value={state.settings.checkInBalance}
          onChange={(e) => setSettings({ checkInBalance: Number(e.target.value) })}
          className="w-28 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        <span className="font-medium ml-2">as of</span>
        <input
          type="date"
          value={state.settings.checkInDate}
          onChange={(e) => setSettings({ checkInDate: e.target.value })}
          className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
      </div>

      {/* Global add — sits just above the tab navigation */}
      <div className="px-6 pt-4">
        <button
          onClick={() => { setEditing(null); setAdding(true); }}
          className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium hover:opacity-90"
        >
          + Add transaction
        </button>
      </div>

      {/* Tabs */}
      <nav className="px-6 pt-3 flex gap-2">
        {["ledger", "budget"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium capitalize transition ${
              tab === t
                ? "bg-white dark:bg-gray-900 border border-b-0 border-gray-200 dark:border-gray-800"
                : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="px-6 pb-16">
        {tab === "ledger" ? (
          <LedgerView
            state={state}
            setSettings={setSettings}
            ledger={ledger}
            onEditItem={editById}
            onDeleteItem={removeItem}
            onTogglePaid={togglePaid}
          />
        ) : (
          <BudgetView
            budget={budget}
            settings={state.settings}
            setSettings={setSettings}
            onEditName={editByName}
            onReorder={reorderNames}
          />
        )}
      </main>

      {formOpen && (
        <EventForm
          key={editing?.id ?? "new"}
          initial={editing ?? undefined}
          onSave={saveItem}
          onCancel={closeForm}
          onDelete={editing ? () => removeItem(editing.id) : undefined}
        />
      )}
    </div>
  );
}
