import { useState, useEffect, useMemo } from "react";
import { loadState, saveState } from "./storage.js";
import { getSession, onAuthChange, signOut } from "./auth.js";
import { computeLedger, computeBudget } from "./engine/compute.js";
import { upsertItem, deleteItem, deleteItems, findItem, itemsByName, swapOrder, reorderList, togglePaidOverride } from "./engine/mutate.js";
import LedgerView from "./components/LedgerView.jsx";
import BudgetView from "./components/BudgetView.jsx";
import EventForm from "./components/EventForm.jsx";
import QuickEntry from "./components/QuickEntry.jsx";
import ExportMenu from "./components/ExportMenu.jsx";
import ImportCSV from "./components/ImportCSV.jsx";
import WipeData from "./components/WipeData.jsx";
import Onboarding from "./components/Onboarding.jsx";
import SignIn from "./components/SignIn.jsx";

export default function App() {
  // undefined = still checking for a session, null = signed out, object = signed in
  const [session, setSession] = useState(undefined);
  const [state, setState] = useState(null); // null until this user's data has loaded
  const [loadError, setLoadError] = useState(null); // set instead of `state` on a failed load
  const [retryTick, setRetryTick] = useState(0);
  const [tab, setTab] = useState("ledger");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // raw rule/one-off being edited
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

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
  // multi-select delete (Ledger) — one atomic removal, no form to close
  function removeItems(ids) {
    setState((s) => deleteItems(s, ids));
  }
  // A deliberate full clear-out is the one legitimate case for saving an
  // empty state — it's a normal setState like any other mutation here, so it
  // isn't affected by (and doesn't need to route around) the load-error fix.
  function wipeData() {
    setState((s) => ({ ...s, recurring: [], oneoffs: [], paidOverrides: {} }));
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
  // Merge (or, if `replace`, wipe first then load) parsed CSV items into
  // current state via upsertItem one at a time, so `order` is assigned
  // safely off whatever's already there (empty, in the replace case) — no
  // chance of colliding with existing items' order values. This is a normal
  // user-initiated state change like any other add/edit — it goes through
  // the same autosave path, which is exactly what the loadState fix
  // protects: that fix only ever blocks a save that followed a FAILED load,
  // and no load is happening here.
  function importCSV(parsed, replace) {
    setState((s) => {
      let next = replace
        ? { ...s, recurring: [], oneoffs: [], paidOverrides: {} }
        : s;
      for (const item of [...parsed.recurring, ...parsed.oneoffs]) {
        next = upsertItem(next, item);
      }
      if (parsed.checkInBalance != null) {
        next = { ...next, settings: { ...next.settings, checkInBalance: parsed.checkInBalance } };
      }
      return next;
    });
  }

  // Onboarding answers reuse the exact same {recurring, oneoffs,
  // checkInBalance} shape the CSV importers produce, so they commit through
  // the same importCSV() path — no separate data pipeline to keep in sync.
  // Always marks hasSeenOnboarding, whether reached by finishing or by
  // "Skip setup" — that's what a completed OR skipped run means, and it's
  // what stops this from auto-popping again (see the effect below).
  function completeOnboarding(result) {
    importCSV(result, false);
    setSettings({ hasSeenOnboarding: true });
    setShowOnboarding(false);
  }

  // Auto-show once per account: only when hasSeenOnboarding is false, which
  // (per storage's migration) only happens for a genuinely new account that
  // has never completed or skipped it — never re-triggered by an empty state
  // alone (e.g. after Wipe Data), since that flag isn't touched by a wipe.
  useEffect(() => {
    if (state && !state.settings.hasSeenOnboarding) setShowOnboarding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.settings?.hasSeenOnboarding]);

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
  //
  // A failed load sets `loadError` and leaves `state` at null — it does NOT
  // fall back to some default/blank object. That matters: the save effect
  // below only ever runs once `state` is non-null, so a load failure blocks
  // every autosave until a load actually succeeds. (A real incident: this
  // used to fall back to a blank state on error, which then got autosaved
  // straight over real cloud data on nothing more than a transient error.)
  useEffect(() => {
    if (!session) { setState(null); setLoadError(null); return; }
    let cancelled = false;
    setLoadError(null);
    loadState(session.user.id)
      .then((s) => { if (!cancelled) setState(s); })
      .catch((err) => { if (!cancelled) { console.error(err); setLoadError(err); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, retryTick]);

  // Persist on every change, once loaded. Same reasoning as above: keyed on
  // the user id, not the whole session object. Guarded on `state` being set,
  // which (per above) never happens after a load error.
  useEffect(() => {
    if (!session || !state) return;
    saveState(session.user.id, state).catch((err) => console.error("save failed", err));
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

  if (session === undefined) return <Splash />;
  if (!session) return <SignIn />;
  if (loadError) return <LoadError message={loadError.message} onRetry={() => setRetryTick((t) => t + 1)} />;
  if (!state) return <Splash />;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight">Budget</h1>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <button
            onClick={() => setImportOpen(true)}
            title="Import CSV"
            className="text-sm px-2.5 sm:px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
          >
            ⬆<span className="hidden sm:inline"> Import CSV</span>
          </button>
          <ExportMenu ledger={ledger} budget={budget} />
          <button
            onClick={() =>
              setSettings({ theme: state.settings.theme === "dark" ? "light" : "dark" })
            }
            className="text-sm px-2.5 sm:px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
          >
            {state.settings.theme === "dark" ? "☀" : "🌙"}
            <span className="hidden sm:inline">{state.settings.theme === "dark" ? " Light" : " Dark"}</span>
          </button>
          <button
            onClick={() => signOut()}
            className="text-sm px-2.5 sm:px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Check-in bar */}
      <div className="px-3 sm:px-6 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/40 flex flex-wrap items-center gap-2 sm:gap-3 text-sm">
        <span className="font-medium">Current TD balance:</span>
        <span className="text-gray-500">$</span>
        <input
          type="number"
          value={state.settings.checkInBalance}
          onChange={(e) => setSettings({ checkInBalance: Number(e.target.value) })}
          className="w-24 sm:w-28 px-2 py-1.5 sm:py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-medium ml-2">as of</span>
          <input
            type="date"
            value={state.settings.checkInDate}
            onChange={(e) => setSettings({ checkInDate: e.target.value })}
            className="px-2 py-1.5 sm:py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        </span>
        <WipeData onWipe={wipeData} />
      </div>

      {/* Global add — sits just above the tab navigation */}
      <div className="px-3 sm:px-6 pt-4 flex items-center gap-2 flex-wrap">
        <button
          onClick={openAddModal}
          className="text-sm px-3 py-2 sm:py-1.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium hover:opacity-90"
        >
          + Add transaction
        </button>
        <button
          onClick={() => (quickEntryOpen ? setQuickEntryOpen(false) : openQuickEntry())}
          className="text-sm px-3 py-2 sm:py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 font-medium hover:bg-gray-100 dark:hover:bg-gray-900 transition"
        >
          {quickEntryOpen ? "Close quick entry" : "⚡ Quick entry"}
        </button>
        <button
          onClick={() => setShowOnboarding(true)}
          className="text-sm px-3 py-2 sm:py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 font-medium hover:bg-gray-100 dark:hover:bg-gray-900 transition"
        >
          🎓 Tutorial
        </button>
      </div>

      {quickEntryOpen && (
        <div className="px-3 sm:px-6 pt-3">
          <QuickEntry onAdd={addItem} onRemove={removeItem} onClose={() => setQuickEntryOpen(false)} />
        </div>
      )}

      {/* Tabs */}
      <nav className="px-3 sm:px-6 pt-3 flex gap-2">
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
      <main className="px-3 sm:px-6 pb-16">
        {tab === "ledger" ? (
          <LedgerView
            state={state}
            setSettings={setSettings}
            ledger={ledger}
            onEditItem={editById}
            onDeleteItem={removeItem}
            onDeleteMany={removeItems}
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

      {importOpen && (
        <ImportCSV onImport={importCSV} onClose={() => setImportOpen(false)} />
      )}

      {showOnboarding && (
        <Onboarding initialBalance={state.settings.checkInBalance || null} onComplete={completeOnboarding} />
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

// Shown instead of the app on a failed load. Deliberately a dead end, not a
// fallback to some default state — nothing here ever calls setState, so
// there is nothing for the autosave effect to write. Only a successful retry
// (or reloading the page) gets you back into the app.
function LoadError({ message, onRetry }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-xl border border-gray-200 dark:border-gray-800 text-center">
        <p className="text-expense font-semibold mb-2">Could not load your data</p>
        <p className="text-sm text-gray-500 mb-4">
          {message} — nothing was changed or saved. Safe to retry.
        </p>
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
