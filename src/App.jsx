import { useState, useEffect, useMemo } from "react";
import { loadState, saveState } from "./storage.js";
import { getSession, onAuthChange, signOut } from "./auth.js";
import { computeLedger, computeBudget } from "./engine/compute.js";
import { upsertItem, deleteItem, findItem, itemsByName, swapOrder, reorderList, togglePaidOverride } from "./engine/mutate.js";
import LedgerView from "./components/LedgerView.jsx";
import BudgetView from "./components/BudgetView.jsx";
import EventForm from "./components/EventForm.jsx";
import QuickEntry from "./components/QuickEntry.jsx";
import SignIn from "./components/SignIn.jsx";

export default function App() {
  // undefined = still checking for a session, null = signed out, object = signed in
  const [session, setSession] = useState(undefined);
  const [state, setState] = useState(null); // null until this user's data has loaded
  const [tab, setTab] = useState("ledger");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // raw rule/one-off being edited
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);

  const formOpen = adding || editing != null;
  const closeForm = () => { setAdding(false); setEditing(null); };

  function openAddModal() {
    setQuickEntryOpen(false);
    setEditing(null);
    setAdding(true);
  }
  function openQuickEntry() {
    closeForm();
    setQuickEntryOpen(true);
  }

  // create or update, then close the form
  function saveItem(evt) {
    setState((s) => upsertItem(s, evt));
    closeForm();
  }
  // quick entry: add without closing anything (the panel stays open)
  function addItem(evt) {
    setState((s) => upsertItem(s, evt));
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
  function reorderDrop(names, name, beforeName) {
    setState((s) => reorderList(s, names, name, beforeName));
  }
  function togglePaid(itemId, monthKey) {
    setState((s) => togglePaidOverride(s, itemId, monthKey));
  }

  // resolve the auth session once, then keep listening for sign-in/out
  useEffect(() => {
    getSession().then(setSession);
    return onAuthChange(setSession);
  }, []);

  // default to the system color scheme before we know the user's saved theme
  // (covers the splash/sign-in screens, which render before `state` exists)
  useEffect(() => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", prefersDark);
  }, []);

  // Load this user's state once signed in; clear it again on sign-out. Keyed
  // on the user id specifically (not the whole `session` object) so this does
  // NOT re-run on Supabase's periodic token refresh — that would reload from
  // the server and silently clobber any not-yet-saved (debounced) local edit.
  useEffect(() => {
    if (!session) { setState(null); return; }
    let cancelled = false;
    loadState(session.user.id).then((s) => { if (!cancelled) setState(s); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Persist on every change, once loaded. Same reasoning as above: keyed on
  // the user id, not the whole session object.
  useEffect(() => {
    if (!session || !state) return;
    saveState(session.user.id, state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, session?.user?.id]);

  // apply dark mode class to <html> from the user's saved preference
  useEffect(() => {
    if (!state) return;
    const root = document.documentElement;
    if (state.settings.theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [state]);

  const setSettings = (patch) =>
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  // computed views (recompute whenever state changes); harmless empty shape while loading
  const ledger = useMemo(
    () => (state ? computeLedger(state, state.settings.ledgerHorizon) : { rows: [], endingBalance: 0 }),
    [state]
  );
  const budget = useMemo(
    () => (state ? computeBudget(state, state.settings.budgetHorizon) : []),
    [state]
  );

  if (session === undefined || (session && !state)) return <Splash />;
  if (!session) return <SignIn />;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Budget</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              setSettings({ theme: state.settings.theme === "dark" ? "light" : "dark" })
            }
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
          >
            {state.settings.theme === "dark" ? "☀ Light" : "🌙 Dark"}
          </button>
          <button
            onClick={() => signOut()}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
          >
            Sign out
          </button>
        </div>
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
      <div className="px-6 pt-4 flex items-center gap-2">
        <button
          onClick={openAddModal}
          className="text-sm px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium hover:opacity-90"
        >
          + Add transaction
        </button>
        <button
          onClick={() => (quickEntryOpen ? setQuickEntryOpen(false) : openQuickEntry())}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 font-medium hover:bg-gray-100 dark:hover:bg-gray-900 transition"
        >
          {quickEntryOpen ? "Close quick entry" : "⚡ Quick entry"}
        </button>
      </div>

      {quickEntryOpen && (
        <div className="px-6 pt-3">
          <QuickEntry onAdd={addItem} onRemove={removeItem} onClose={() => setQuickEntryOpen(false)} />
        </div>
      )}

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
            onReorderDrop={reorderDrop}
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

function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 dark:bg-gray-950 dark:text-gray-400 text-sm">
      Loading…
    </div>
  );
}
