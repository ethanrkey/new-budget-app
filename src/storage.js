// ---- Save/load app state (Supabase-backed, one row per signed-in user) ----
// This is the ONE file that knows where the bytes live. The shape/merge/
// migration logic is unchanged from the localStorage era; only the transport
// changed, per the architecture principle in PROJECT_SPEC.md.
//
// Writes are CONDITIONAL on the version (`updated_at`) we loaded. A device
// holding a stale copy — a phone that's been open since before you changed
// something on a laptop — matches zero rows and is told so, instead of
// overwriting newer data with its whole stale document. See engine/syncGuard.js.
import { supabase } from "./supabase.js";
import { normalize } from "./engine/stateShape.js";
import { makeRecoveryEnvelope, isRecoveryEnvelope } from "./engine/syncGuard.js";

const LOCAL_KEY = "budget-app-state-v1";        // legacy localStorage key, for one-time import
const RECOVERY_KEY = "budget-app-recovery-v1";  // last in-memory copy we had to discard
const SAVE_DEBOUNCE_MS = 500;

// The version token (the row's `updated_at`) for the row we currently hold,
// owned HERE rather than by the caller. Two edits a moment apart would
// otherwise both be sent with whatever version the caller last saw — and the
// second would false-positive as a conflict while the first write was still
// in flight. Writes are also serialized below for the same reason.
let currentUserId = null;
let currentVersion = null;

export function getVersion() {
  return currentVersion;
}

function readLocalBackup() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function isEmptyState(state) {
  return (state?.recurring?.length ?? 0) === 0 && (state?.oneoffs?.length ?? 0) === 0;
}

// ---- The recovery copy ----
// Called before ANYTHING replaces the in-memory state with the server's copy.
// Cheap, synchronous, and best-effort: if localStorage is full or blocked we
// say so rather than throwing, because refusing to reload would leave the user
// stuck on a copy that can never be saved. Returns whether it was written.
export function stashRecoveryCopy(state, reason) {
  try {
    const envelope = makeRecoveryEnvelope(state, reason, new Date().toISOString());
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(envelope));
    return true;
  } catch (err) {
    console.error("could not write the recovery copy", err);
    return false;
  }
}

// The stashed copy, or null if there isn't a valid one. Never throws.
export function readRecoveryCopy() {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isRecoveryEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearRecoveryCopy() {
  try { localStorage.removeItem(RECOVERY_KEY); } catch { /* ignore */ }
}

// ---- Writes ----
// Returns { ok: true, version } on success, or { ok: false, reason } where
// reason is "conflict" (the row moved on under us — do NOT retry blindly) or
// "error". Never upserts: an upsert can't express "only if unchanged".
async function writeState(userId, state) {
  const version = userId === currentUserId ? currentVersion : null;
  // Defense in depth: if this write would erase previously-saved data, that's
  // suspicious enough to log loudly even though we don't block it outright —
  // a deliberate full clear-out (delete every item one by one) is a legitimate
  // state too, and silently refusing to persist it would be its own data-loss
  // bug. The real protections are elsewhere: loadState() can no longer
  // manufacture a fake empty state, and the version check below stops a stale
  // device writing at all.
  if (isEmptyState(state)) {
    const { data: existing } = await supabase
      .from("budget_states").select("state").eq("user_id", userId).maybeSingle();
    if (existing?.state && !isEmptyState(existing.state)) {
      console.error(
        "⚠️ Saving an EMPTY state over a cloud row that currently has data. " +
        "This is allowed (e.g. you deleted everything on purpose) but is logged " +
        "here in case it's not what you intended."
      );
    }
  }

  const nextVersion = new Date().toISOString();

  // No version means we loaded a user with no row at all: this is the first
  // write. A unique-violation here means a row appeared since — treat that as
  // a conflict rather than forcing our copy over it.
  if (!version) {
    const { data, error } = await supabase
      .from("budget_states")
      .insert({ user_id: userId, state, updated_at: nextVersion })
      .select("updated_at")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") return { ok: false, reason: "conflict" };
      console.error("saveState failed", error);
      return { ok: false, reason: "error", error };
    }
    currentUserId = userId;
    currentVersion = data?.updated_at ?? nextVersion;
    return { ok: true, version: currentVersion };
  }

  const { data, error } = await supabase
    .from("budget_states")
    .update({ state, updated_at: nextVersion })
    .eq("user_id", userId)
    .eq("updated_at", version) // <- the guard: only if nobody else has written
    .select("updated_at")
    .maybeSingle();

  if (error) {
    console.error("saveState failed", error);
    return { ok: false, reason: "error", error };
  }
  // Zero rows matched: the row still exists (RLS would have errored otherwise),
  // so its updated_at moved — another device wrote while we held this copy.
  if (!data) return { ok: false, reason: "conflict" };
  currentVersion = data.updated_at;
  return { ok: true, version: currentVersion };
}

// ---- Loads ----
// Returns { state, version }. `version` is the row's updated_at, the token
// every later write is conditional on; it is null only when no row existed
// before this call created one.
//
// IMPORTANT: on any query error, this THROWS rather than falling back to a
// blank/local-backup state. A silent fallback here previously produced a
// blank-looking-but-legitimate state object that flowed straight into the
// autosave effect and upserted over real cloud data on a transient error —
// that's exactly how a real user's budget got wiped. The caller (App.jsx)
// must catch this, show an error, and leave `state` unset — the save effect
// only ever runs once `state` is set, so a caught load error blocks every
// autosave until a load actually succeeds.
export async function loadState(userId) {
  const { data, error } = await supabase
    .from("budget_states")
    .select("state, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load your data from Supabase: ${error.message}`);
  }

  if (data?.state) {
    currentUserId = userId;
    currentVersion = data.updated_at;
    return { state: normalize(data.state), version: currentVersion };
  }

  // Confirmed (not inferred from an error) — no row exists yet for this user.
  // Safe to treat as a brand-new account and import any local backup.
  const imported = normalize(readLocalBackup());
  currentUserId = userId;
  currentVersion = null; // no row yet -> the first write is an insert
  const result = await writeState(userId, imported);
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
  return { state: imported, version: result.ok ? result.version : null };
}

// Just the version, for the cheap "did anything change while I was away?"
// check when the app regains focus. Returns null if it can't tell — callers
// treat that as "no news", never as "changed".
export async function fetchVersion(userId) {
  const { data, error } = await supabase
    .from("budget_states")
    .select("updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("version check failed", error);
    return null;
  }
  return data?.updated_at ?? null;
}

let saveTimer = null;
let writing = false;
let queue = Promise.resolve();

// Debounced: several rapid state changes (e.g. typing) collapse into one
// write. Writes are also SERIALIZED — each waits for the one before it — so
// the version token a write is conditional on is always the one the previous
// write just produced, never a stale copy read before it landed. Returns a
// promise for the write that actually ends up firing (a call superseded by a
// later one before its timer elapses never settles) so callers can detect a
// conflict or a failed save.
export function saveState(userId, state) {
  if (!userId) return Promise.resolve({ ok: true });
  if (saveTimer) clearTimeout(saveTimer);
  return new Promise((resolve, reject) => {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writing = true;
      // .catch here keeps one failed write from poisoning the chain for every
      // write after it; the branch below is what actually reports this one.
      queue = queue.catch(() => {}).then(() => writeState(userId, state)).finally(() => { writing = false; });
      queue.then(resolve, reject);
    }, SAVE_DEBOUNCE_MS);
  });
}

// True while a write of ours is still waiting to fire, or is in flight. The
// focus check uses this to stay out of the way: reloading from the server
// while an edit of ours hasn't landed yet would discard that edit.
export function hasPendingSave() {
  return saveTimer != null || writing;
}

// Sign-out / user switch: forget the version so nothing can be written
// against another account's token.
export function resetSyncState() {
  currentUserId = null;
  currentVersion = null;
}
