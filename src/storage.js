// ---- Save/load app state (Supabase-backed, one row per signed-in user) ----
// This is the ONE file that knows where the bytes live. The shape/merge/
// migration logic is unchanged from the localStorage era; only the transport
// changed, per the architecture principle in PROJECT_SPEC.md.
import { supabase } from "./supabase.js";
import { blankState, TRACKER_CATEGORIES } from "./engine/model.js";

const LOCAL_KEY = "budget-app-state-v1"; // legacy localStorage key, for one-time import
const SAVE_DEBOUNCE_MS = 500;

function normalize(parsed) {
  // merge onto blank so new fields always exist
  const base = blankState();
  return {
    ...base,
    ...parsed,
    settings: { ...base.settings, ...(parsed.settings || {}) },
    recurring: (parsed.recurring || []).map(migrateItem),
    oneoffs: (parsed.oneoffs || []).map(migrateItem),
    paidOverrides: parsed.paidOverrides || {},
  };
}

// One-time migration: the old model had a preset `savings` category plus a
// separate `tracker` field. Now the category IS the tracker. Promote a set
// tracker to the category, fold leftover `savings` into `saved`, drop `tracker`.
function migrateItem(item) {
  const { tracker, ...rest } = item;
  let category = rest.category;
  if (TRACKER_CATEGORIES.includes(tracker)) category = tracker;
  else if (category === "savings") category = "saved";
  return { ...rest, category };
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

async function writeState(userId, state) {
  // Defense in depth: if this write would erase previously-saved data, that's
  // suspicious enough to log loudly even though we don't block it outright —
  // a deliberate full clear-out (delete every item one by one) is a legitimate
  // state too, and silently refusing to persist it would be its own data-loss
  // bug. The real fix is below: loadState() can no longer manufacture a fake
  // empty state that flows into an autosave in the first place.
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
  const { error } = await supabase
    .from("budget_states")
    .upsert({ user_id: userId, state, updated_at: new Date().toISOString() });
  if (error) console.error("saveState failed", error);
}

// Load this user's state. On their very first sign-in (no row yet), imports
// whatever this browser has sitting in localStorage from before the Supabase
// switch, so nothing already entered gets lost — then clears that local copy.
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
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load your data from Supabase: ${error.message}`);
  }

  if (data?.state) return normalize(data.state);

  // Confirmed (not inferred from an error) — no row exists yet for this user.
  // Safe to treat as a brand-new account and import any local backup.
  const imported = normalize(readLocalBackup());
  await writeState(userId, imported);
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
  return imported;
}

let saveTimer = null;
// Debounced: several rapid state changes (e.g. typing) collapse into one
// write. Returns a promise for the write that actually ends up firing (a
// call superseded by a later one before its timer elapses never settles) so
// callers can detect a failed save.
export function saveState(userId, state) {
  if (!userId) return Promise.resolve();
  if (saveTimer) clearTimeout(saveTimer);
  return new Promise((resolve, reject) => {
    saveTimer = setTimeout(() => {
      writeState(userId, state).then(resolve, reject);
    }, SAVE_DEBOUNCE_MS);
  });
}
