import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  loadState, saveState, fetchVersion, getVersion, hasPendingSave, resetSyncState,
  stashRecoveryCopy, readRecoveryCopy,
  fetchDeletionRequest, requestAccountDeletion, cancelAccountDeletion, purgeDueAccounts,
} from "./storage.js";
import { downloadFile } from "./downloadFile.js";
import { isStale } from "./engine/syncGuard.ts";
import { getSession, onAuthChange, signOut } from "./auth.js";
import { getDeviceTheme, setDeviceTheme } from "./theme.js";
import { computeLedger, computeBudget } from "./engine/compute.ts";
import {
  upsertItem, deleteItem, deleteItems, findItem, itemsByName, swapOrder, reorderList,
  setOverride, clearOverride, orphanedOverrideDates, wipeToNewAccount,
  addCategory, updateCategory, deleteCategory, moveCategory,
  addBalanceSnapshot, updateBalanceSnapshot, deleteBalanceSnapshot, setMonthlyActual, deleteMonthlyActual,
  updateAccountBalance, updateAccountSnapshot, deleteAccountSnapshot, setupLoan, setupAsset, moveTab,
  addContribution, updateContribution, deleteContribution, countTaggedItems,
} from "./engine/mutate.ts";
import { primaryAccount, sanitizeTabOrder, ledgerHorizonOf, todayISO } from "./engine/model.ts";
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
import AccountScreen from "./components/AccountScreen.jsx";
import Onboarding from "./components/Onboarding.jsx";
import Tutorial from "./components/Tutorial.jsx";
import GuidedTour from "./components/GuidedTour.jsx";
import SignIn from "./components/SignIn.jsx";
import SyncNotice from "./components/SyncNotice.jsx";
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
  const [editingDate, setEditingDate] = useState(null); // which occurrence, when opened from a Ledger row
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  // null when closed; otherwise where it was opened FROM, so it can offer a
  // way back there ("settings" gets a "Back to Settings" link).
  const [categoryManagerFrom, setCategoryManagerFrom] = useState(null);
  // Settings subscreens are siblings of Settings, not children: each one
  // closes Settings and reopens it on Back, so there is only ever one modal
  // on screen and no stacked scrims.
  const [accountOpen, setAccountOpen] = useState(false);
  const [addPresetCategory, setAddPresetCategory] = useState(null); // e.g. Dashboard's "+ Add a loan" shortcut
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateBalanceOpen, setUpdateBalanceOpen] = useState(false);
  // Multi-device safety. The version token every write is conditional on
  // lives in storage.js (it has to, to stay correct across overlapping
  // writes). `skipNextSave` suppresses the autosave that would otherwise fire
  // the instant a load puts server data into state — nothing has changed yet,
  // and writing it back would bump the version for nothing.
  const skipNextSave = useRef(false);
  const [syncNotice, setSyncNotice] = useState(null);
  const [deletionRequest, setDeletionRequest] = useState(null);
  const [tourOpen, setTourOpen] = useState(false);
  // Mirrors `state` for listeners that are registered once and would
  // otherwise close over a stale value.
  const stateRef = useRef(null);
  const [draggingTab, setDraggingTab] = useState(null);
  const [dragOverTab, setDragOverTab] = useState(null);

  const formOpen = adding || editing != null;
  const closeForm = () => { setAdding(false); setEditing(null); setEditingDate(null); setAddPresetCategory(null); };

  // `presetCategory` pre-selects a category in the Add form (used by the
  // Dashboard's "+ Add a loan" shortcut on an unconfigured Debt category) —
  // optional, everything else about a normal Add is unchanged.
  function openAddModal(presetCategory = null) {
    setQuickEntryOpen(false);
    setEditing(null);
    setEditingDate(null);
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
  // Wipe Data leaves a GENUINE new account, not a half-cleared one. It used
  // to keep settings, the account balance, categories and every logged
  // snapshot — so hasSeenOnboarding survived and the app came back looking
  // used, with no welcome wizard, which is not what "wipe" means to anyone.
  // wipeToNewAccount() is blankState(), so what you get is byte-for-byte
  // what a brand-new account gets (modulo the fresh category uids and
  // today-derived horizons, which a new account mints too).
  function wipeData() {
    setState(() => wipeToNewAccount());
  }

  // Open the edit form for a ledger row id ("<itemId>@<date>") or a bare
  // item id. The DATE half is kept: it is what lets the form offer "this
  // date" as a scope. A bare id (the Budget's row names) has no occurrence,
  // so that form edits the rule, which is the only thing it could mean.
  function editById(id) {
    const [itemId, date] = id.split("@");
    const it = findItem(state, itemId);
    if (it) { setEditing(it); setEditingDate(date ?? null); }
  }
  // open the edit form from a Budget row name — only when it maps to exactly one item
  function editByName(name) {
    const matches = itemsByName(state, name);
    if (matches.length === 1) { setEditing(matches[0]); setEditingDate(null); }
  }

  // ---- Per-occurrence overrides ----
  function saveOverride(ruleId, date, amount) {
    setState((s) => setOverride(s, ruleId, date, amount));
    closeForm();
  }
  function removeOverride(ruleId, date) {
    setState((s) => clearOverride(s, ruleId, date));
    closeForm();
  }
  function reorderNames(nameA, nameB) {
    setState((s) => swapOrder(s, nameA, nameB));
  }
  function reorderDrop(names, name, beforeName) {
    setState((s) => reorderList(s, names, name, beforeName));
  }
  // Tracker category (savings/debt/investment) CRUD — deleting one never
  // touches items still tagged with it (see mutate.ts's addCategory et al.).
  function addTrackerCategory(name, kind) {
    // addCategory lost its `color` parameter in migration 13; this still
    // passed 0 in its place, so every category added from the manager was
    // created with kind === 0. App.jsx is JS, so tsc could not see it.
    setState((s) => addCategory(s, name, kind));
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
  // fully editable/deletable after the fact (see mutate.ts).
  function logContribution(categoryId, amount, date) {
    setState((s) => addContribution(s, categoryId, amount, date));
  }
  function editContribution(categoryId, entryId, patch) {
    setState((s) => updateContribution(s, categoryId, entryId, patch));
  }
  function removeContribution(categoryId, entryId) {
    setState((s) => deleteContribution(s, categoryId, entryId));
  }

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
        ? { ...s, recurring: [], oneoffs: [] }
        : s;
      for (const item of [...parsed.recurring, ...parsed.oneoffs]) {
        next = upsertItem(next, item);
      }
      // The CSV's balance is deliberately IGNORED. It carries no
      // verification date — "as of the export", which we cannot know — so
      // adopting it stamped a fabricated observation onto the account's
      // current as-of date. Round-tripping your own export therefore logged
      // a second snapshot identical to the one already there, which is
      // exactly the duplicate history that turned up in real data (Sep 28
      // twice at $444.49; Oct 1 holding two different figures). An import
      // brings in FORECAST items; the verified balance has one entry point,
      // and it is the Update balance modal, where you supply the date.
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
  // snapshot + rollback mirror), see mutate.ts. Nothing is written while the
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
  // creates a transaction (see mutate.ts setupLoan).
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
  // The wizard commits its OWN result; it used to borrow importCSV, and
  // that coupling silently broke it. When importCSV stopped adopting a
  // balance (2026-10-02 — a CSV carries no verification date, so stamping
  // one was fabricating an observation), the wizard lost its balance with
  // it, and a new user's first ledger projected from zero. The wizard is
  // not an import: the user is sitting in front of the app typing the
  // number, so today IS the verification date and principle 1 is satisfied
  // — the balance and its as-of date both come from them.
  function completeOnboarding({ recurring = [], oneoffs = [], checkInBalance, accounts = [] }) {
    setState((s) => {
      let next = s;
      for (const item of [...recurring, ...oneoffs]) next = upsertItem(next, item);
      if (checkInBalance != null && !Number.isNaN(Number(checkInBalance))) {
        next = updateAccountBalance(next, primaryAccount(next).id, Number(checkInBalance), todayISO());
      }
      // Savings, investments and debt from the wizard's last step. Debt is
      // created WITHOUT terms on purpose — name and what you owe now is
      // enough for the category, the card and the net position, and asking
      // for principal, APR and a start date during setup is where someone
      // gives up. The card prompts for terms later, when there is
      // something to point at.
      for (const a of accounts) {
        // A brand-new account is SEEDED with categories called Savings,
        // Investments and Debt (defaultTrackerCategories). Without this, a
        // wizard row called "Savings" makes a second one and the Dashboard
        // shows two, one of them permanently empty. Reuse an existing
        // same-named category when it has nothing logged against it —
        // never one that does, because that would be writing into
        // somebody's real history on a name collision.
        const existing = next.trackerCategories.find(
          (c) => c.name.trim().toLowerCase() === a.name.toLowerCase()
            && (next.balanceSnapshots?.[c.id] ?? []).length === 0
        );
        if (a.group === "debt") {
          let id = existing?.kind === "debt" ? existing.id : null;
          if (!id) {
            next = addCategory(next, a.name, "debt");
            id = next.trackerCategories[next.trackerCategories.length - 1].id;
          }
          next = addBalanceSnapshot(next, id, Math.abs(a.amount), todayISO());
        } else {
          next = setupAsset(next, {
            categoryId: existing?.kind === "asset" ? existing.id : null,
            name: a.name, balance: a.amount, asOf: todayISO(), assetKind: a.group,
          });
        }
      }
      // The seeded defaults that were never used go. A brand-new account
      // gets Savings / Investments / Debt from defaultTrackerCategories as
      // a hint; once the wizard has actually ASKED about all three, an
      // untouched one is just clutter on the Dashboard — and worse, it
      // looks like something the wizard created, which is exactly how a
      // real user read it. Only ones with nothing logged and nothing
      // tagged: never a category carrying data.
      for (const c of [...next.trackerCategories]) {
        const seeded = ["savings", "investments", "debt"].includes(c.name.trim().toLowerCase());
        const empty = (next.balanceSnapshots?.[c.id] ?? []).length === 0
          && countTaggedItems(next, c.id) === 0
          && (next.contributionLog?.[c.id] ?? []).length === 0;
        if (seeded && empty) next = deleteCategory(next, c.id);
      }
      return next;
    });
    setSettings({ hasSeenOnboarding: true });
    setShowOnboarding(false);
    setTourOpen(true);
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
    if (!session) { setState(null); setLoadError(null); setDeletionRequest(null); resetSyncState(); return; }
    let canceled = false;
    setLoadError(null);
    // Is this account already scheduled for deletion? Asked on every load,
    // because a pending deletion has to be visible from the moment you open
    // the app, not only if you happen to go looking in Settings.
    fetchDeletionRequest(session.user.id).then((r) => { if (!canceled) setDeletionRequest(r); });
    // Sweep any account whose grace period has expired. The backstop for
    // pg_cron being unavailable; non-fatal, never blocks this load.
    purgeDueAccounts();
    loadState(session.user.id)
      .then(({ state: s }) => {
        if (canceled) return;
        skipNextSave.current = true;
        setState(s);
        // Open on whichever tab this user dragged to the front.
        setTab(sanitizeTabOrder(s.settings.tabOrder)[0]);
      })
      .catch((err) => { if (!canceled) { console.error(err); setLoadError(err); } });
    return () => { canceled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, retryTick]);

  useEffect(() => { stateRef.current = state; }, [state]);

  // Hand back the copy we had to discard, as an ordinary full-backup JSON —
  // the same shape Import → Restore accepts, so it's not a dead-end artifact.
  function downloadRecoveryCopy() {
    const copy = readRecoveryCopy();
    if (!copy) return;
    downloadFile(
      `budget-recovery-${copy.savedAt.slice(0, 10)}.json`,
      JSON.stringify(copy.state, null, 2),
      "application/json"
    );
  }

  // Replace what's in memory with the server's copy — but stash the copy
  // we're discarding FIRST, always, before anything else happens. That stash
  // is the whole safety net: a reload that swaps your data under you must
  // never be the moment something becomes unrecoverable.
  const adoptServerState = useCallback(async (userId, discarded, kind) => {
    const stashed = discarded ? stashRecoveryCopy(discarded, kind) : false;
    const { state: fresh } = await loadState(userId);
    skipNextSave.current = true;
    setState(fresh);
    setSyncNotice({ kind, stashed });
  }, []);

  // Persist on every change, once loaded. Same reasoning as above: keyed on
  // the user id, not the whole session object. Guarded on `state` being set,
  // which (per above) never happens after a load error.
  //
  // The write is conditional on the loaded version: if another device wrote
  // since we loaded, ours matches no row and comes back as a conflict. We do
  // NOT retry — this device's whole document is the stale one, and forcing it
  // through is precisely the overwrite this guard exists to prevent.
  useEffect(() => {
    if (!session || !state) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    saveState(session.user.id, state)
      .then((res) => {
        if (res?.ok) { setSyncNotice((n) => (n?.kind === "error" ? null : n)); return; }
        if (res?.reason === "conflict") return adoptServerState(session.user.id, state, "conflict");
        // Anything else: the write did not land and we are NOT reloading, so
        // the only honest thing is to say so. Silently carrying on while
        // nothing reaches the server is the worst shape this can take.
        setSyncNotice({ kind: "error" });
      })
      .catch((err) => {
        console.error("save failed", err);
        setSyncNotice({ kind: "error" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, session?.user?.id]);

  // Coming back to the app: check whether the row moved while we were away,
  // and adopt it if so. This is what stops a backgrounded phone from sitting
  // on a stale copy until it's fully reopened. Skipped while one of our own
  // writes is still debounced — reloading then would discard that edit.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    let checking = false;
    async function check() {
      if (document.visibilityState !== "visible") return;
      if (!getVersion() || hasPendingSave() || checking) return;
      checking = true;
      try {
        const serverVersion = await fetchVersion(userId);
        if (isStale(getVersion(), serverVersion)) {
          await adoptServerState(userId, stateRef.current, "refreshed");
        }
      } finally {
        checking = false;
      }
    }
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [session?.user?.id, adoptServerState]);

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
    () => (state ? computeLedger(state, ledgerHorizonOf(state)) : { rows: [], endingBalance: 0 }),
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
        {/* The brass of the app icon. #eebb4d is the icon's own gold and is
            10:1 on the dark surface, but 1.70:1 on the light one — unreadable
            — so light mode takes the same hue (42deg) stepped down to 30%
            lightness, 4.91:1 on gray-50. Two steps of one hue, exactly like
            the category palette. */}
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-[#8e670b] dark:text-[#eebb4d]">
          Key Budget
        </h1>
        <div className="flex items-center gap-1.5 sm:gap-3">
          {/* The Tutorial is not a thing you DO with your data, it is a
              thing you read once — so it sits in the header beside the
              other read-and-leave controls, not in the action row next to
              Add transaction. */}
          <button
            onClick={() => setShowOnboarding(true)}
            title="Re-run the setup wizard"
            className="text-sm px-2.5 sm:px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
          >
            🚀<span className="hidden sm:inline"> Setup</span>
          </button>
          <button
            onClick={() => setTutorialOpen(true)}
            title="How everything works"
            className="text-sm px-2.5 sm:px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
          >
            ?<span className="hidden sm:inline"> About</span>
          </button>
          <button
            onClick={() => setImportOpen(true)}
            title="Import a CSV, or restore a full JSON backup"
            className="text-sm px-2.5 sm:px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
          >
            ⬇<span className="hidden sm:inline"> Import</span>
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

      <SyncNotice
        notice={syncNotice}
        onDownload={downloadRecoveryCopy}
        onDismiss={() => setSyncNotice(null)}
        onReload={() => window.location.reload()}
      />

      {/* Account strip — read-only; the balance only changes via the
          Update balance modal's Confirm. Replaces the old live-edit bar. */}
      <AccountStrip account={account} onUpdateClick={() => setUpdateBalanceOpen(true)} />

      {/* Global add — sits just above the tab navigation */}
      {/* The action row is what you DO with your data. Quick Setup and
          About are not that — one you run once, the other you read when
          confused — so both live in the header instead. */}
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
      </div>

      {quickEntryOpen && (
        <div className="px-3 sm:px-6 pt-3">
          <QuickEntry onAdd={addItem} onRemove={removeItem} onClose={() => setQuickEntryOpen(false)} trackerCategories={state.trackerCategories} />
        </div>
      )}

      {/* Tabs — drag to reorder on desktop (HTML5 drag never fires from a
          touch drag, so phones just get plain tabs, which is what they want:
          a stray drag while scrolling would be worse than no reordering). */}
      {/* Underline tabs, not a folder seam: the Dashboard renders free-floating
          cards while the other three render an attached panel, and a seam can
          only work for one of those. An underline reads the same either way,
          and it removes a bordered container from an already busy header.
          Scrolls rather than shrinking — four tabs already overflow a 390px
          phone, and sanitizeTabOrder exists so a fifth is cheap to add. */}
      <nav className="px-3 sm:px-6 pt-3 flex gap-2 overflow-x-auto no-scrollbar">
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
            className={`shrink-0 px-3 pb-2 pt-1 text-sm capitalize transition border-b-2 ${
              tab === t
                ? "border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100 font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            } ${draggingTab === t ? "opacity-40" : ""} ${
              dragOverTab === t && draggingTab && draggingTab !== t
                ? "border-gray-400 dark:border-gray-500"
                : ""
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {/* Content — uniform spacing for every tab. The old Dashboard-only gap
          existed to stop its rounded card colliding with the active tab's
          square bottom edge; underline tabs have no edge to collide with, so
          the special case is gone. */}
      <main className="px-3 sm:px-6 pt-4 pb-16">
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
              onDeleteCategory={deleteTrackerCategory}
              countTagged={(catId) => countTaggedItems(state, catId)}
              onAddContribution={logContribution}
              onUpdateContribution={editContribution}
              onDeleteContribution={removeContribution}
            />
          ) : (
            <SpendingView
              onUntrack={(item) => setState((st) => upsertItem(st, { ...item, variable: false }))}
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
          occurrenceDate={editingDate}
          overrideAmount={editing && editingDate ? state.overrides?.[editing.id]?.[editingDate] ?? null : null}
          onSaveOverride={saveOverride}
          onClearOverride={removeOverride}
          onCheckOrphans={(next) => orphanedOverrideDates(state, next, ledgerHorizonOf(state))}
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

      {tutorialOpen && (
        <Tutorial
          onClose={() => setTutorialOpen(false)}
          onStartTour={() => { setTutorialOpen(false); setTourOpen(true); }}
        />
      )}

      {/* Fires once, right after the wizard; re-triggerable from About.
          Not persisted as "seen" separately — finishing the wizard is the
          only thing that starts it, and that already happens once. */}
      {tourOpen && (
        <GuidedTour onGoToTab={setTab} onClose={() => setTourOpen(false)} />
      )}

      {showOnboarding && (
        <Onboarding initialBalance={account.balance || null} onComplete={completeOnboarding} />
      )}

      {settingsOpen && (
        <SettingsModal
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onOpenCategories={() => { setSettingsOpen(false); setCategoryManagerFrom("settings"); }}
          onOpenAccount={() => { setSettingsOpen(false); setAccountOpen(true); }}
          onWipe={wipeData}
          email={session?.user?.email}
          deletionRequest={deletionRequest}
          onRequestDeletion={async () => {
            const res = await requestAccountDeletion(session.user.id);
            if (res.ok) setDeletionRequest(res.request);
            return res;
          }}
          onCancelDeletion={async () => {
            const res = await cancelAccountDeletion(session.user.id);
            if (res.ok) setDeletionRequest(null);
            return res;
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {accountOpen && (
        <AccountScreen
          email={session?.user?.email}
          providers={session?.user?.app_metadata?.providers}
          createdAt={session?.user?.created_at}
          onSignOut={() => signOut()}
          onBack={() => { setAccountOpen(false); setSettingsOpen(true); }}
          onClose={() => setAccountOpen(false)}
        />
      )}

      {updateBalanceOpen && (
        <UpdateBalanceModal account={account} onConfirm={confirmBalance} onClose={() => setUpdateBalanceOpen(false)} />
      )}

      {categoryManagerFrom && (
        <CategoryManager
          categories={state.trackerCategories}
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
