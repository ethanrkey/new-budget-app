import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  loadState, saveState, fetchVersion, getVersion, hasPendingSave, resetSyncState,
  stashRecoveryCopy, readRecoveryCopy,
  fetchDeletionRequest, requestAccountDeletion, cancelAccountDeletion, purgeDueAccounts,
} from "./storage.js";
import { downloadFile } from "./downloadFile.js";
import { isStale } from "./engine/syncGuard.ts";
import { getSession, onAuthChange, signOut, takeInvoluntarySignOut } from "./auth.js";
import { getDeviceTheme, setDeviceTheme } from "./theme.js";
import { computeLedger, computeBudget, rowsHiddenByAnchor } from "./engine/compute.ts";
import {
  upsertItem, deleteItem, deleteItems, findItem, swapOrder, reorderList,
  setOverride, clearOverride, orphanedOverrideDates, wipeToNewAccount,
  addCategory, updateCategory, deleteCategory, moveCategory,
  addBalanceSnapshot, updateBalanceSnapshot, deleteBalanceSnapshot, setMonthlyActual, deleteMonthlyActual,
  updateAccountBalance, updateAccountSnapshot, deleteAccountSnapshot, setupLoan, setupAsset, moveTab,
  addContribution, updateContribution, deleteContribution, countTaggedItems,
} from "./engine/mutate.ts";
import { primaryAccount, sanitizeTabOrder, ledgerHorizonOf } from "./engine/model.ts";
import { applySetup } from "./engine/setup.ts";
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
import { supabase } from "./supabase.js";
import { isAllowlisted as plaidAllowlisted, pullBalance, readConnection } from "./shared/plaidApi.ts";
import { shouldPullOnOpen, shouldOfferHint } from "./shared/connect.ts";

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
  // The last sign-out was not asked for — the session stopped being
  // usable. Shown on the sign-in screen so a returning user is told
  // what happened instead of guessing.
  const [expired, setExpired] = useState(false);
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
  // date" as a scope. A bare id (a Budget row's key) has no occurrence,
  // so that form edits the rule, which is the only thing it could mean.
  //
  // THE BUDGET USES THIS ONE NOW. It had its own, which looked the row
  // up by the name on it and gave up when two items shared one — so
  // clicking either of two bills called "Discover Bill" did nothing at
  // all. The rows carry ids since 2026-10-19 and there is nothing left
  // to guess.
  function editById(id) {
    const [itemId, date] = id.split("@");
    const it = findItem(state, itemId);
    if (it) { setEditing(it); setEditingDate(date ?? null); }
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
  function reorderRows(idA, idB) {
    setState((s) => swapOrder(s, idA, idB));
  }
  function reorderDrop(ids, id, beforeId) {
    setState((s) => reorderList(s, ids, id, beforeId));
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
  // WHAT setup creates now lives in engine/setup.ts, so the phone can
  // call the same function instead of reimplementing fifty lines of
  // decisions. This is the wiring; the decisions are there, with their
  // reasons. Moved 2026-10-12.
  //
  // THE TOUR RUNS ITSELF ONCE PER ACCOUNT, since 2026-10-16. It used
  // to start on every completion, so re-running Setup from the header
  // replayed it — reported on build 11. The flag is read BEFORE the
  // write, because the write sets it.
  function completeOnboarding(answers) {
    const firstTime = !state.settings.hasSeenTour;
    setState((s) => applySetup(s, answers));
    setSettings({ hasSeenOnboarding: true, hasSeenTour: true });
    setShowOnboarding(false);
    // Nothing device-local decides this: a new browser or a second
    // machine must not replay a tour this account has already had.
    // It stays reachable by hand from About → "Take the tour".
    if (firstTime) setTourOpen(true);
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
  //
  // `expired` is the one thing worth remembering about a sign-out:
  // whether anybody asked for it. A session that stopped working puts
  // you on the same screen as pressing Sign out, which is why "the
  // web signs me out every so often" has never had any evidence
  // attached to it. See takeInvoluntarySignOut in auth.js.
  useEffect(() => {
    getSession().then(setSession);
    return onAuthChange((next, event) => {
      if (event === "SIGNED_OUT" && takeInvoluntarySignOut()) {
        setExpired(true);
        // Logged as well as shown. A tester who reports "it signed me
        // out again" can be asked for this line, and it carries the
        // timestamp the console will not otherwise have.
        console.warn(`[auth] session ended without a sign-out at ${new Date().toISOString()}`);
      }
      if (next) setExpired(false);
      setSession(next);
    });
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

  // Re-read the server's copy with nothing to discard. Used after a
  // balance was pulled server-side: the write happened in an edge
  // function, so nothing in this tab would otherwise notice.
  const reloadFromServer = useCallback(async () => {
    if (!session?.user?.id) return;
    const { state: fresh } = await loadState(session.user.id);
    skipNextSave.current = true;
    setState(fresh);
  }, [session?.user?.id]);

  // THE BANK CONNECTION, read once and handed to the strip.
  //
  // Inert with connected features off: the effect returns before it
  // asks anything, so an ordinary manual account makes no request and
  // Plaid's script is never added to the page. The 12-hour staleness
  // window belongs to the SERVER — per account, so one pull serves
  // every device — and this only decides whether to make the call.
  const [connection, setConnection] = useState(null);
  const [plaidBeta, setPlaidBeta] = useState(false);
  const connectedFeatures = !!state?.settings?.connectedFeatures;
  useEffect(() => {
    let dead = false;
    (async () => {
      const ok = await plaidAllowlisted(supabase);
      if (dead) return;
      setPlaidBeta(ok);
      if (!ok) return;
      // THE HINT'S AUDIENCE HAS THE FEATURE OFF, so the allowlist is
      // read either way and only the connection read is gated.
      if (!connectedFeatures) { setConnection(null); return; }
      const row = await readConnection(supabase);
      if (dead || !row) return;
      setConnection(row);
      if (!shouldPullOnOpen({ connectedFeatures }, row)) return;
      const result = await pullBalance(supabase, "open");
      if (dead || !result) return;
      setConnection((c) => c && { ...c, status: result.status ?? c.status, lastSyncedAt: result.lastSyncedAt ?? c.lastSyncedAt });
      // A pull that actually wrote changed a snapshot on the server,
      // and nothing in this tab would have noticed.
      if (result.synced && result.applied === "written") void reloadFromServer();
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedFeatures]);

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
  if (!session) return <SignIn expired={expired} />;
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
          {/* SETUP AND ABOUT ARE IN SETTINGS, from 2026-10-17, where
              the phone has always kept them — they are read-or-run
              once and were taking two of five header slots. Import
              and Export stayed: they are the file controls, used
              repeatedly and mid-task. See SettingsModal's note. */}
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
            title="Settings — setup, about, the tour, appearance, categories, sign out, wipe data"
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
      <AccountStrip
        account={account}
        connection={connection}
        newestSnapshot={(state.accountSnapshots?.[account.id] ?? []).at(-1)}
        onUpdateClick={() => setUpdateBalanceOpen(true)}
      />

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
            onEditRow={editById}
            onReorder={reorderRows}
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
              onAddRecurring={saveItem}
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

      {/* Fires after the FIRST setup this account completes, and after
          that only from About — see completeOnboarding and
          settings.hasSeenTour.

          `landingTab` is the same expression the load effect uses to
          pick the opening tab, so "where the tour ends" and "where
          this app lands" are one thing rather than two that agree. */}
      {tourOpen && (
        <GuidedTour
          onGoToTab={setTab}
          landingTab={sanitizeTabOrder(state.settings.tabOrder)[0]}
          onClose={() => setTourOpen(false)}
        />
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
          onOpenSetup={() => { setSettingsOpen(false); setShowOnboarding(true); }}
          onOpenAbout={() => { setSettingsOpen(false); setTutorialOpen(true); }}
          onStartTour={() => { setSettingsOpen(false); setTourOpen(true); }}
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
          settings={state.settings}
          setSettings={setSettings}
          onPulled={() => { void reloadFromServer(); }}
          onSignOut={() => signOut()}
          onBack={() => { setAccountOpen(false); setSettingsOpen(true); }}
          onClose={() => setAccountOpen(false)}
        />
      )}

      {updateBalanceOpen && (
        <UpdateBalanceModal
          account={account}
          onConfirm={confirmBalance}
          onClose={() => setUpdateBalanceOpen(false)}
          offerConnectHint={shouldOfferHint(state.settings, plaidBeta)}
          onOpenSettings={() => { setUpdateBalanceOpen(false); setAccountOpen(true); }}
          onHideHint={() => setSettings({ hideConnectHint: true })}
          // Only the CHECKING balance moves the forecast's starting
          // point, so only this one previews what it hides. The
          // contribution modal below reuses this component and passes
          // nothing, which is correct — a contribution hides nothing.
          hiddenRows={(asOf) => rowsHiddenByAnchor(state, asOf, ledgerHorizonOf(state))}
        />
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
