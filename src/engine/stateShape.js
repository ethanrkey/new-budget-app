// ---- Pure state-shape logic: normalization + migrations ----
// Split out of storage.js so this is testable without pulling in the
// Supabase client (which needs Vite's import.meta.env and can't be imported
// from plain Node) — and so it stays reusable if storage.js's backend ever
// changes again, per the same "keep it swappable" principle storage.js
// itself follows.
import { blankState, TRACKER_CATEGORIES } from "./model.js";

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

// Merge a raw loaded/imported object onto blankState() so every field always
// exists, running item migrations and the onboarding-seen migration below.
export function normalize(parsed) {
  const base = blankState();
  const settings = { ...base.settings, ...(parsed.settings || {}) };
  const recurring = (parsed.recurring || []).map(migrateItem);
  const oneoffs = (parsed.oneoffs || []).map(migrateItem);

  // Migration: hasSeenOnboarding predates this account (the field is
  // genuinely absent, not just false) AND they already have real data —
  // this is an existing user from before the welcome wizard existed, not a
  // new one. Mark it seen retroactively so the wizard never gets sprung on
  // someone who's already using the app for real.
  if (parsed.settings?.hasSeenOnboarding === undefined && (recurring.length > 0 || oneoffs.length > 0)) {
    settings.hasSeenOnboarding = true;
  }

  return {
    ...base,
    ...parsed,
    settings,
    recurring,
    oneoffs,
    paidOverrides: parsed.paidOverrides || {},
  };
}
