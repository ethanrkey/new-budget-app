// ---- Pure state-shape logic: normalization + migrations ----
// Split out of storage.js so this is testable without pulling in the
// Supabase client (which needs Vite's import.meta.env and can't be imported
// from plain Node) — and so it stays reusable if storage.js's backend ever
// changes again, per the same "keep it swappable" principle storage.js
// itself follows.
import { blankState } from "./model.js";

// One-time migration: very old data had a separate `tracker` field and/or a
// preset `savings` category. Promote any set `tracker` straight to the
// category (category IS the tracker, no fixed list to validate against
// anymore — everything but income/bill/oneoff is a user-defined tracker
// category now), and fold a leftover `savings` category into "saved", which
// the tracker-categories migration below always seeds for an existing user.
function migrateItem(item) {
  const { tracker, ...rest } = item;
  let category = rest.category;
  if (tracker) category = tracker;
  else if (category === "savings") category = "saved";
  return { ...rest, category };
}

// Legacy roth/saved/brokerage/loans -> editable tracker categories, same ids
// as the old fixed category keys so existing items' `category` fields need
// no rewriting at all. Colors are deliberately NOT the old ones — "saved"
// used to be the same green as income, which was the actual bug this
// feature replaces.
export function legacyTrackerCategories() {
  return [
    { id: "roth", name: "Roth", color: 5, order: 0 },           // Indigo
    { id: "saved", name: "Saved", color: 2, order: 1 },         // Teal
    { id: "brokerage", name: "Brokerage", color: 0, order: 2 }, // Blue
    { id: "loans", name: "Loans", color: 3, order: 3 },         // Gold
  ];
}

// Merge a raw loaded/imported object onto blankState() so every field always
// exists, running item migrations and the onboarding-seen / tracker-category
// migrations below.
export function normalize(parsed) {
  const base = blankState();
  const settings = { ...base.settings, ...(parsed.settings || {}) };
  const recurring = (parsed.recurring || []).map(migrateItem);
  const oneoffs = (parsed.oneoffs || []).map(migrateItem);
  const hasData = recurring.length > 0 || oneoffs.length > 0;

  // Migration: hasSeenOnboarding predates this account (the field is
  // genuinely absent, not just false) AND they already have real data —
  // this is an existing user from before the welcome wizard existed, not a
  // new one. Mark it seen retroactively so the wizard never gets sprung on
  // someone who's already using the app for real.
  if (parsed.settings?.hasSeenOnboarding === undefined && hasData) {
    settings.hasSeenOnboarding = true;
  }

  // Migration: trackerCategories predates this account (genuinely absent,
  // not an empty array they deliberately cleared) — an existing user gets
  // their legacy 4 preserved as real, editable categories (same ids, so no
  // item needs its `category` rewritten); a genuinely new account keeps
  // blankState()'s fresh 3 defaults.
  const trackerCategories =
    parsed.trackerCategories === undefined
      ? (hasData ? legacyTrackerCategories() : base.trackerCategories)
      : parsed.trackerCategories;

  return {
    ...base,
    ...parsed,
    settings,
    recurring,
    oneoffs,
    paidOverrides: parsed.paidOverrides || {},
    trackerCategories,
  };
}
