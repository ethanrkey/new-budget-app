// ---- Save/load app state to the browser (localStorage) ----
// Later, this file is the ONE place you swap in a real backend (Supabase, etc.)
import { blankState, TRACKER_CATEGORIES } from "./engine/model.js";

const KEY = "budget-app-state-v1";

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blankState();
    const parsed = JSON.parse(raw);
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
  } catch {
    return blankState();
  }
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

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error("save failed", e);
  }
}