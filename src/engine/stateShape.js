// ---- Pure state-shape logic: normalization + migrations ----
// Split out of storage.js so this is testable without pulling in the
// Supabase client (which needs Vite's import.meta.env and can't be imported
// from plain Node) — and so it stays reusable if storage.js's backend ever
// changes again, per the same "keep it swappable" principle storage.js
// itself follows.
import { blankState, defaultAccounts, PRIMARY_ACCOUNT_ID } from "./model.js";

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
    { id: "roth", name: "Roth", color: 5, order: 0, kind: "asset" },           // Indigo
    { id: "saved", name: "Saved", color: 2, order: 1, kind: "asset" },         // Teal
    { id: "brokerage", name: "Brokerage", color: 0, order: 2, kind: "asset" }, // Blue
    { id: "loans", name: "Loans", color: 3, order: 3, kind: "debt" },          // Gold
  ];
}

// Migration: `kind` (asset/debt — see model.js) predates the loan-
// amortization feature, so it's missing from BOTH a category that just came
// out of legacyTrackerCategories() in an OLDER build (before this function
// added `kind` above) and any custom category a user already created via
// CategoryManager before this feature existed. Infer it rather than default
// everything to "asset": the exact legacy "loans" id, or a name that clearly
// reads as debt, becomes "debt" — anything else defaults to "asset", the
// safer direction (a real debt just keeps behaving like it did before this
// feature existed — cumulative-payments based — until you flip it in
// Categories; misclassifying a real asset as debt would silently feed it
// through the wrong math with no such fallback).
function inferCategoryKind(cat) {
  if (cat.kind) return cat.kind;
  if (cat.id === "loans" || /\b(debt|loans?|credit card)\b/i.test(cat.name)) return "debt";
  return "asset";
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
  const trackerCategoriesRaw =
    parsed.trackerCategories === undefined
      ? (hasData ? legacyTrackerCategories() : base.trackerCategories)
      : parsed.trackerCategories;
  // Always backfill `kind`, even for an already-migrated custom list — see
  // inferCategoryKind's comment above for why this can't just be folded
  // into the branch above (a user who already has a real trackerCategories
  // array saved from before `kind` existed still needs it added).
  const trackerCategories = trackerCategoriesRaw.map((c) => ({ ...c, kind: inferCategoryKind(c) }));

  // Migration: `accounts` predates this state — build the one checking
  // account straight from the legacy settings.checkInBalance/checkInDate,
  // so the balance and its verified date carry over to the cent/day. If
  // accounts already exist they pass through untouched (idempotent — this
  // runs on every load). An empty array is treated as absent too; Phase 1
  // has no way to delete the only account, so that can only be corruption.
  const accounts =
    !Array.isArray(parsed.accounts) || parsed.accounts.length === 0
      ? defaultAccounts(Number(settings.checkInBalance) || 0, settings.checkInDate)
      : parsed.accounts;
  const primaryId = accounts[0].id ?? PRIMARY_ACCOUNT_ID;
  // Every transaction belongs to an account. Pre-migration items have no
  // accountId — they all belonged to the one implicit checking account.
  const stamp = (it) => (it.accountId ? it : { ...it, accountId: primaryId });

  // Seed the account's balance history with the balance it already has, so
  // the Phase 2 chart starts from the verified figure rather than empty.
  // Only when there's no history at all — never appended on later loads.
  // The seed id is DETERMINISTIC (not uid()) so normalize stays a pure
  // function of its input: two devices migrating the same legacy state
  // produce byte-identical results, and the harness can assert exact
  // equality across independent runs.
  const accountSnapshots = { ...(parsed.accountSnapshots || {}) };
  if (!accountSnapshots[primaryId]?.length) {
    accountSnapshots[primaryId] = [{ id: `seed-${primaryId}`, date: accounts[0].balanceAsOf, amount: accounts[0].balance }];
  }

  // Rollback safety net (one release): settings.checkInBalance/checkInDate
  // MIRROR accounts[0] so an older build, if Vercel is rolled back, still
  // reads the right balance. accounts[0] is the source of truth; the mirror
  // is derived from it here, never the other way around post-migration.
  settings.checkInBalance = accounts[0].balance;
  settings.checkInDate = accounts[0].balanceAsOf;

  return {
    ...base,
    ...parsed,
    settings,
    accounts,
    recurring: recurring.map(stamp),
    oneoffs: oneoffs.map(stamp),
    paidOverrides: parsed.paidOverrides || {},
    trackerCategories,
    // Brand-new fields, no legacy shape to fold in — an existing account
    // simply never had any actuals logged yet, same as paidOverrides above.
    balanceSnapshots: parsed.balanceSnapshots || {},
    monthlyActuals: parsed.monthlyActuals || {},
    accountSnapshots,
  };
}
