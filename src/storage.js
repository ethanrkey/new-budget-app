// ---- Save/load app state (Supabase-backed, one row per signed-in user) ----
// This is the ONE file that knows where the bytes live. The shape/merge/
// migration logic is unchanged from the localStorage era; only the transport
// changed, per the architecture principle in PROJECT_SPEC.md.
//
// Storage is ONE ROW PER ENTITY (`budget_entities`), not one document per
// user. A save sends only the entities that actually changed, so two devices
// editing different things no longer conflict at all — which is the point.
//
// Writes stay CONDITIONAL, now per entity: each update carries the `version`
// counter we loaded for that row and matches zero rows if somebody else got
// there first. A counter rather than a timestamp, because a counter has no
// clock in it and this codebase does not trust device clocks.
//
// The shape/merge/migration logic is still unchanged from the localStorage
// era: splitState/assembleState are pure engine functions, so this file
// remains transport only. If diffing ever drifts in here, the split went
// wrong.
import { supabase } from "./supabase.js";
import { normalize } from "./engine/stateShape.ts";
import { makeRecoveryEnvelope, isRecoveryEnvelope } from "./engine/syncGuard.ts";
import { splitState, assembleState, diffEntities, tombstoneAlarm } from "./engine/entities.ts";

const LOCAL_KEY = "budget-app-state-v1";        // legacy localStorage key, for one-time import
const RECOVERY_KEY = "budget-app-recovery-v1";  // last in-memory copy we had to discard
const SAVE_DEBOUNCE_MS = 500;

// The version token (the row's `updated_at`) for the row we currently hold,
// owned HERE rather than by the caller. Two edits a moment apart would
// otherwise both be sent with whatever version the caller last saw — and the
// second would false-positive as a conflict while the first write was still
// in flight. Writes are also serialized below for the same reason.
let currentUserId = null;
// The cheap "did anything change while I was away?" token: the newest
// updated_at across this user's rows. Compared as an opaque string, never
// ordered — same rule as before.
let currentVersion = null;
// Per-entity: "kind:id" -> version counter, for the conditional writes.
let versions = new Map();
// The baseline a save diffs against. ALWAYS normalize(assemble(rows)), never
// the raw rows: normalize() seeds a snapshot for an account that has none and
// mints default categories for a new account, so diffing against raw rows
// would make every load write phantom rows it never had.
let baseline = [];

export function getVersion() {
  return currentVersion;
}

const keyOf = (e) => `${e.kind}:${e.id}`;

function readLocalBackup() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
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
  if (userId !== currentUserId) {
    // Never write one account's rows against another's bookkeeping.
    return { ok: false, reason: "error" };
  }

  const next = splitState(state);
  const diff = diffEntities(baseline, next);
  if (diff.upserts.length === 0 && diff.tombstones.length === 0) {
    return { ok: true, version: currentVersion };
  }

  // The entity-level replacement for the old whole-document "saving an empty
  // state over a non-empty one" alarm. That check could not be ported —
  // there is no document to be empty — and it stands where a real data-loss
  // incident already happened, so its equivalent has to stand somewhere.
  // Logged, not blocked: wiping your own account is a legitimate thing to do.
  if (tombstoneAlarm(baseline, diff)) {
    console.error(
      `⚠️ This save removes ${diff.tombstones.length} of ${baseline.length} stored rows. ` +
      "Allowed (a deliberate wipe looks exactly like this) but logged in case it isn't what you meant."
    );
  }

  // Upserts BEFORE tombstones, and abort on the first refusal. These are
  // separate statements, not one transaction, so a conflict part-way leaves
  // the rows that already landed in place; ordering it this way means a
  // conflict stops us before anything is removed. The caller's response to a
  // conflict is to adopt the server's copy after stashing a recovery copy,
  // so nothing is lost — but a single RPC doing this in one transaction is
  // the honest fix and is on the roadmap.
  for (const e of diff.upserts) {
    const known = versions.get(keyOf(e));
    const row = {
      user_id: userId, kind: e.kind, entity_id: e.id,
      data: e.data, schema_version: e.schemaVersion,
    };

    if (known === undefined) {
      const { data, error } = await supabase
        .from("budget_entities").insert(row).select("version,updated_at").maybeSingle();
      if (error) {
        // A row appeared since we loaded: treat as a conflict, never force.
        if (error.code === "23505") return { ok: false, reason: "conflict" };
        console.error("saveState insert failed", error);
        return { ok: false, reason: "error", error };
      }
      versions.set(keyOf(e), data.version);
      currentVersion = data.updated_at;
      continue;
    }

    const { data, error } = await supabase
      .from("budget_entities")
      .update({ data: e.data, schema_version: e.schemaVersion, deleted_at: null })
      .eq("user_id", userId).eq("kind", e.kind).eq("entity_id", e.id)
      .eq("version", known) // <- the guard
      .select("version,updated_at").maybeSingle();
    if (error) { console.error("saveState update failed", error); return { ok: false, reason: "error", error }; }
    if (!data) return { ok: false, reason: "conflict" }; // zero rows: it moved under us
    versions.set(keyOf(e), data.version);
    currentVersion = data.updated_at;
  }

  for (const ref of diff.tombstones) {
    const known = versions.get(`${ref.kind}:${ref.id}`);
    const q = supabase
      .from("budget_entities")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", userId).eq("kind", ref.kind).eq("entity_id", ref.id);
    const { data, error } = await (known === undefined ? q : q.eq("version", known))
      .select("version,updated_at").maybeSingle();
    if (error) { console.error("saveState tombstone failed", error); return { ok: false, reason: "error", error }; }
    if (!data) return { ok: false, reason: "conflict" };
    versions.delete(`${ref.kind}:${ref.id}`);
    currentVersion = data.updated_at;
  }

  baseline = next;
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
    .from("budget_entities")
    .select("kind,entity_id,data,version,schema_version,updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to load your data from Supabase: ${error.message}`);
  }

  currentUserId = userId;
  versions = new Map();
  currentVersion = null;
  for (const r of data) {
    versions.set(`${r.kind}:${r.entity_id}`, r.version);
    if (!currentVersion || r.updated_at > currentVersion) currentVersion = r.updated_at;
  }

  if (data.length > 0) {
    const state = normalize(assembleState(
      data.map((r) => ({ kind: r.kind, id: r.entity_id, data: r.data, schemaVersion: r.schema_version }))
    ));
    // The baseline is the ASSEMBLED-AND-NORMALIZED state, not these rows —
    // see the note on `baseline` above. Getting this wrong makes every load
    // write phantom rows.
    baseline = splitState(state);
    return { state, version: currentVersion };
  }

  // Confirmed (not inferred from an error) — this user has no rows at all.
  // A brand-new account: seed it and write the seed, exactly as before.
  const imported = normalize(readLocalBackup());
  baseline = [];
  const result = await writeState(userId, imported);
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
  return { state: imported, version: result.ok ? result.version : null };
}

// Just the version, for the cheap "did anything change while I was away?"
// check when the app regains focus. Returns null if it can't tell — callers
// treat that as "no news", never as "changed".
export async function fetchVersion(userId) {
  // The newest row wins: one cheap query, still an opaque token, and any
  // write to any entity moves it. Tombstones count — a delete elsewhere is
  // exactly the kind of change this is here to notice.
  const { data, error } = await supabase
    .from("budget_entities")
    .select("updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
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
  versions = new Map();
  baseline = [];
}
