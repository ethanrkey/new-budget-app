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

async function writeState(userId, state) {
  const { error } = await supabase
    .from("budget_states")
    .upsert({ user_id: userId, state, updated_at: new Date().toISOString() });
  if (error) console.error("saveState failed", error);
}

// Load this user's state. On their very first sign-in (no row yet), imports
// whatever this browser has sitting in localStorage from before the Supabase
// switch, so nothing already entered gets lost — then clears that local copy.
export async function loadState(userId) {
  const { data, error } = await supabase
    .from("budget_states")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("loadState failed, falling back to this browser's local backup", error);
    return normalize(readLocalBackup());
  }

  if (data?.state) return normalize(data.state);

  const imported = normalize(readLocalBackup());
  await writeState(userId, imported);
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
  return imported;
}

let saveTimer = null;
// Debounced: several rapid state changes (e.g. typing) collapse into one write.
export function saveState(userId, state) {
  if (!userId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeState(userId, state), SAVE_DEBOUNCE_MS);
}
