import { useState, useEffect, useMemo } from "react";
import { loadState, saveState } from "./storage.js";
import { getSession, onAuthChange, signOut } from "./auth.js";
import { getDeviceTheme, setDeviceTheme } from "./theme.js";
import { computeLedger, computeBudget } from "./engine/compute.js";
import {
  upsertItem, deleteItem, deleteItems, findItem, itemsByName, swapOrder, reorderList, togglePaidOverride,
  addCategory, updateCategory, deleteCategory, moveCategory,
  addBalanceSnapshot, updateBalanceSnapshot, deleteBalanceSnapshot, setMonthlyActual, deleteMonthlyActual,
  updateAccountBalance, updateAccountSnapshot, deleteAccountSnapshot, setupLoan, setupAsset, moveTab,
} from "./engine/mutate.js";
import { primaryAccount, sanitizeTabOrder } from "./engine/model.js";
import LedgerView from "./components/LedgerView.jsx";
import BudgetView from "./components/BudgetView.jsx";
import Dashboard from "./components/Dashboard.jsx";
import SpendingView from "./components/SpendingView.jsx";
import EventForm from "./components/EventForm.jsx";
import QuickEntry from "./components/QuickEntry.jsx";
import ExportMenu from "./components/ExportMenu.jsx";
import ImportCSV from "./components/ImportCSV.jsx";
import AccountStrip from "./components/AccountStrip.jsx";
import UpdateBalanceModal from "./components/UpdateBalanceModal.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import Onboarding from "./components/Onboarding.jsx";
import Tutorial from "./components/Tutorial.jsx";
import SignIn from "./components/SignIn.jsx";
import CategoryManager from "./components/CategoryManager.jsx";

export default function App() {
  // undefined = still checking for a session, null = signed out, object = signed in
  const [session, setSession] = useState(undefined);
  const [state, setState] = useState(null); // null until this user's data has loaded
  const [loadError, setLoadError] = useState(null); // set instead of `state` on a failed load
  const [retryTick, setRetryTick] = useState(0);
  const [tab, setTab] = useState("dashboard");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // raw rule/one-off being edited
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  // null when closed; otherwise where it was opened FROM, so it can offer a
  // way back there ("settings" gets a "Back to Settings" link).
  const [categoryManagerFrom, setCategoryManagerFrom] = useState(null);
  const [addPresetCategory, setAddPresetCategory] = useState(null); // e.g. Dashboard's "+ Add a loan" shortcut
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateBalanceOpen, setUpdateBalanceOpen] = useState(false);
  const [draggingTab, setDraggingTab] = useState(null);
  const [dragOverTab, setDragOverTab] = useState(null);

  const formOpen = adding || editing != null;
  const closeForm = () => { setAdding(false); setEditing(null); setAddPresetCategory(null); };

  // `presetCategory` pre-selects a category in the Add form (used by the
  // Dashboard's "+ Add a loan" shortcut on an unconfigured Debt category) —
  // optional, everything else about a normal Add is unchanged.
  function openAddModal(presetCategory = null) {
    setQuickEntryOpen(false);
    setEditing(null);
    setAddPresetCategory(presetCategory);
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
  // Clears monthlyActuals too (they're keyed to items that no longer exist),
  // but deliberately leaves balanceSnapshots alone — those are your own
  // logged real-world account balances, not forecast data, and Wipe Data
  // should never quietly delete something you can't get back.
  function wipeData() {
    setState((s) => ({ ...s, recurring: [], oneoffs: [], paidOverrides: {}, monthlyActuals: {} }));
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
  // Tracker category (savings/debt/investment) CRUD — deleting one never
  // touches items still tagged with it (see mutate.js's addCategory et al.).
  function addTrackerCategory(name, color, kind) {
    setState((s) => addCategory(s, name, color, kind));
  }
  function updateTrackerCategory(id, patch) {
    setState((s) => updateCategory(s, id, patch));
  }
  function deleteTrackerCategory(id) {
    setState((s) => deleteCategory(s, id));
  }
  function moveTrackerCategory(id, direction) {
    setState((s) => moveCategory(s, id, direction));
  }
  // Dashboard: fund-balance snapshots + variable-bill monthly actuals — both
  // fully editable/deletable after the fact (see mutate.js).
  function addSnapshot(categoryId, amount, date) {
    setState((s) => addBalanceSnapshot(s, categoryId, amount, date));
  }
  function updateSnapshot(categoryId, snapshotId, patch) {
    setState((s) => updateBalanceSnapshot(s, categoryId, snapshotId, patch));
  }
  function deleteSnapshot(categoryId, snapshotId) {
    setState((s) => deleteBalanceSnapshot(s, categoryId, snapshotId));
  }
  function logMonthlyActual(itemId, monthKey, amount) {
    setState((s) => setMonthlyActual(s, itemId, monthKey, amount));
  }
  function clearMonthlyActual(itemId, monthKey) {
    setState((s) => deleteMonthlyActual(s, itemId, monthKey));
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
      // A Budget-grid CSV carries a balance but no verification date (it's
      // "as of the export," which we can't know) — keep the current as-of
      // date and just move the balance, through the same atomic path as a
      // manual update so the history snapshot + rollback mirror stay in sync.
      if (parsed.checkInBalance != null) {
        const acct = primaryAccount(next);
        next = updateAccountBalance(next, acct.id, parsed.checkInBalance, acct.balanceAsOf);
      }
      return next;
    });
  }

  // A full JSON backup restore, unlike a CSV import, is always a total
  // replace — `restoredState` has already been through normalize() by the
  // time it gets here (see ImportCSV.jsx), so this is just a normal
  // setState like any other mutation, going through the same autosave path.
  function restoreBackup(restoredState) {
    setState(() => restoredState);
  }

  // The "Update balance" confirm — the ONLY path that moves the account's
  // verified balance. One atomic transition (balance + as-of + history
  // snapshot + rollback mirror), see mutate.js. Nothing is written while the
  // modal's fields are being typed into.
  function confirmBalance(amount, date) {
    setState((s) => updateAccountBalance(s, primaryAccount(s).id, amount, date));
    setUpdateBalanceOpen(false);
  }
  // Checking-account history stays editable/deletable like every other logged value.
  function updateAcctSnapshot(accountId, snapshotId, patch) {
    setState((s) => updateAccountSnapshot(s, accountId, snapshotId, patch));
  }
  function deleteAcctSnapshot(accountId, snapshotId) {
    setState((s) => deleteAccountSnapshot(s, accountId, snapshotId));
  }
  // Loan setup / edit-terms — a loan is a debt-kind category; this never
  // creates a transaction (see mutate.js setupLoan).
  function setupLoanHandler(payload) {
    setState((s) => setupLoan(s, payload));
  }
  function setupAssetHandler(payload) {
    setState((s) => setupAsset(s, payload));
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
      .then((s) => {
        if (cancelled) return;
        setState(s);
        // Open on whichever tab this user dragged to the front.
        setTab(sanitizeTabOrder(s.settings.tabOrder)[0]);
      })
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

  // Per-device theme (theme.js) — NOT the same as settings.theme, which is
  // the synced account default. Re-derive whenever the account default
  // changes (covers first load, and another device changing the default);
  // getDeviceTheme itself checks THIS device's localStorage first, so a
  // device that's already personalized its own theme is unaffected either
  // way.
  // Initial value matches system preference — covers the splash/sign-in
  // screens, which render before `state` (and so this device's actual
  // resolved theme) exists yet. Lazy initializer so window.matchMedia only
  // runs once, on mount.
  const [theme, setTheme] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );
  useEffect(() => {
    if (!state) return;
    setTheme(getDeviceTheme(state.settings.theme));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.settings?.theme]);

  // apply dark mode class to <html> from this device's theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [theme]);

  // Toggling theme is local-first: this device's choice takes effect
  // immediately and is remembered independently of any other device, while
  // also updating the account default (settings.theme) so a device that's
  // never personalized its own theme yet still inherits something sensible.
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setDeviceTheme(next);
    setTheme(next);
    setSettings({ theme: next });
  }

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

  const isDark = theme === "dark";
  const account = primaryAccount(state); // the one account everything anchors to (Phase 1: single-account)

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight">Budget</h1>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <button
            onClick={() => setImportOpen(true)}
            title="Import a CSV, or restore a full JSON backup"
            className="text-sm px-2.5 sm:px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
          >
            ⬆<span className="hidden sm:inline"> Import</span>
          </button>
          <ExportMenu ledger={ledger} budget={budget} trackerCategories={state.trackerCategories} state={state} />
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings — appearance, categories, sign out, wipe data"
            className="text-sm px-2.5 sm:px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
          >
            ⚙<span className="hidden sm:inline"> Settings</span>
          </button>
        </div>
      </header>

      {/* Account strip — read-only; the balance only changes via the
          Update balance modal's Confirm. Replaces the old live-edit bar. */}
      <AccountStrip account={account} onUpdateClick={() => setUpdateBalanceOpen(true)} />

      {/* Global add — sits just above the tab navigation */}
      <div className="px-3 sm:px-6 pt-4 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => openAddModal()}
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
          🚀 Quick Setup
        </button>
        <button
          onClick={() => setTutorialOpen(true)}
          title="Every feature, explained"
          className="text-sm px-3 py-2 sm:py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 font-medium hover:bg-gray-100 dark:hover:bg-gray-900 transition"
        >
          📖 Tutorial
        </button>
      </div>

      {quickEntryOpen && (
        <div className="px-3 sm:px-6 pt-3">
          <QuickEntry onAdd={addItem} onRemove={removeItem} onClose={() => setQuickEntryOpen(false)} trackerCategories={state.trackerCategories} />
        </div>
      )}

      {/* Tabs — drag to reorder on desktop (HTML5 drag never fires from a
          touch drag, so phones just get plain tabs, which is what they want:
          a stray drag while scrolling would be worse than no reordering). */}
      <nav className="px-3 sm:px-6 pt-3 flex gap-2">
        {sanitizeTabOrder(state.settings.tabOrder).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            draggable
            onDragStart={(e) => { setDraggingTab(t); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => { setDraggingTab(null); setDragOverTab(null); }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (t !== dragOverTab) setDragOverTab(t); }}
            onDragLeave={() => setDragOverTab((cur) => (cur === t ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingTab && draggingTab !== t) setState((s) => moveTab(s, draggingTab, t));
              setDraggingTab(null);
              setDragOverTab(null);
            }}
            title="Drag to reorder"
            className={`px-4 py-2 rounded-t-lg text-sm font-medium capitalize transition ${
              tab === t
                ? "bg-white dark:bg-gray-900 border border-b-0 border-gray-200 dark:border-gray-800"
                : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            } ${draggingTab === t ? "opacity-40" : ""} ${
              dragOverTab === t && draggingTab && draggingTab !== t
                ? "ring-2 ring-gray-400 dark:ring-gray-500"
                : ""
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
            trackerCategories={state.trackerCategories}
            isDark={isDark}
            onEditItem={editById}
            onDeleteItem={removeItem}
            onDeleteMany={removeItems}
            onTogglePaid={togglePaid}
            onOpenOnboarding={() => setShowOnboarding(true)}
            onOpenCategoryManager={() => setCategoryManagerFrom("ledger")}
          />
        ) : tab === "budget" ? (
          <BudgetView
            budget={budget}
            settings={state.settings}
            setSettings={setSettings}
            trackerCategories={state.trackerCategories}
            isDark={isDark}
            accountName={account.name}
            onEditName={editByName}
            onReorder={reorderNames}
            onReorderDrop={reorderDrop}
            onOpenOnboarding={() => setShowOnboarding(true)}
          />
        ) : (
          tab === "dashboard" ? (
            <Dashboard
              state={state}
              isDark={isDark}
              onAddSnapshot={addSnapshot}
              onUpdateSnapshot={updateSnapshot}
              onDeleteSnapshot={deleteSnapshot}
              onUpdateAccountBalance={() => setUpdateBalanceOpen(true)}
              onUpdateAccountSnapshot={updateAcctSnapshot}
              onDeleteAccountSnapshot={deleteAcctSnapshot}
              onSetupLoan={setupLoanHandler}
              onSetupAsset={setupAssetHandler}
            />
          ) : (
            <SpendingView
              state={state}
              onSetMonthlyActual={logMonthlyActual}
              onDeleteMonthlyActual={clearMonthlyActual}
            />
          )
        )}
      </main>

      {formOpen && (
        <EventForm
          key={editing?.id ?? "new"}
          initial={editing ?? undefined}
          presetCategory={addPresetCategory}
          trackerCategories={state.trackerCategories}
          isDark={isDark}
          onSave={saveItem}
          onCancel={closeForm}
          onDelete={editing ? () => removeItem(editing.id) : undefined}
        />
      )}

      {importOpen && (
        <ImportCSV
          onImport={importCSV}
          onRestoreBackup={restoreBackup}
          onClose={() => setImportOpen(false)}
          trackerCategories={state.trackerCategories}
          currentState={state}
        />
      )}

      {tutorialOpen && <Tutorial onClose={() => setTutorialOpen(false)} />}

      {showOnboarding && (
        <Onboarding initialBalance={account.balance || null} onComplete={completeOnboarding} />
      )}

      {settingsOpen && (
        <SettingsModal
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onOpenCategories={() => { setSettingsOpen(false); setCategoryManagerFrom("settings"); }}
          onWipe={wipeData}
          onSignOut={() => signOut()}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {updateBalanceOpen && (
        <UpdateBalanceModal account={account} onConfirm={confirmBalance} onClose={() => setUpdateBalanceOpen(false)} />
      )}

      {categoryManagerFrom && (
        <CategoryManager
          categories={state.trackerCategories}
          isDark={isDark}
          onAdd={addTrackerCategory}
          onUpdate={updateTrackerCategory}
          onDelete={deleteTrackerCategory}
          onMove={moveTrackerCategory}
          onClose={() => setCategoryManagerFrom(null)}
          onBack={
            categoryManagerFrom === "settings"
              ? () => { setCategoryManagerFrom(null); setSettingsOpen(true); }
              : undefined
          }
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
