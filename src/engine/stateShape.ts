// ---- Pure state-shape logic: normalization + migrations ----
// Split out of storage.js so this is testable without pulling in the
// Supabase client (which needs Vite's import.meta.env and can't be imported
// from plain Node) — and so it stays reusable if storage.js's backend ever
// changes again, per the same "keep it swappable" principle storage.js
// itself follows.
import { blankState, defaultAccounts, sanitizeTabOrder, PRIMARY_ACCOUNT_ID } from "./model.ts";
import type { BalanceSnapshot, BudgetState, RawState, TrackerCategory } from "./types.ts";

// One-time migration: very old data had a separate `tracker` field and/or a
// preset `savings` category. Promote any set `tracker` straight to the
// category (category IS the tracker, no fixed list to validate against
// anymore — everything but income/bill/oneoff is a user-defined tracker
// category now), and fold a leftover `savings` category into "saved", which
// the tracker-categories migration below always seeds for an existing user.
// `any` here is deliberate and is the point of the whole file: the input is
// data written by builds that no longer exist, with fields this codebase has
// since deleted. Narrowing it would mean inventing a type for every historical
// shape, and the first convenient "fix" to satisfy such a type is exactly how
// a legacy state silently becomes a different state.
function migrateItem(item: any): any {
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
export function legacyTrackerCategories(): TrackerCategory[] {
  return [
    // No colour and no assetKind: these are the ids a legacy state's items
    // already point at, so the names must not change — but nothing here can
    // answer "market-exposed or not", and a migration must not guess it.
    { id: "roth", name: "Roth", order: 0, kind: "asset" },
    { id: "saved", name: "Saved", order: 1, kind: "asset" },
    { id: "brokerage", name: "Brokerage", order: 2, kind: "asset" },
    { id: "loans", name: "Loans", order: 3, kind: "debt" },
  ];
}

// Migration: `kind` (asset/debt — see model.ts) predates the loan-
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
function inferCategoryKind(cat: any): "asset" | "debt" {
  if (cat.kind) return cat.kind;
  if (cat.id === "loans" || /\b(debt|loans?|credit card)\b/i.test(cat.name)) return "debt";
  return "asset";
}

// Merge a raw loaded/imported object onto blankState() so every field always
// exists, running item migrations and the onboarding-seen / tracker-category
// migrations below.
// Migration 13 (2026-10-03): `color` is DROPPED from tracker categories.
// Colour is derived from role now (engine/palette.ts) and nothing reads
// the stored index; left in place it would ride along in every save
// forever, and the next person to see it would reasonably assume it meant
// something. Stripped the same way `paidOverrides` was — explicitly,
// because normalize() spreads the parsed blob and an unread field is
// otherwise immortal.

// Migration 12 (2026-10-03): `assetKind` on asset categories — "savings"
// (cash you control) or "investment" (value the market moves). Added as
// ABSENT, never inferred. A name cannot answer it: an HSA reads like
// savings and can be entirely in one stock, which makes it the most
// market-exposed thing someone owns rather than the least. Guessing here
// would hardcode that error for every user, and maintenance rule 5 forbids
// a migration fabricating values the user did not enter.
//
// Absent renders as `investment` (see palette.ts assetRole), and that
// direction is deliberate: an investment gets no projected line, so an
// unanswered account WITHHOLDS a projection rather than drawing one over
// market-exposed value. The reverse default reads as equally defensible
// until you notice which way the error falls.

// Migration 11 (2026-10-02): collapse snapshots that share a date, keeping
// the LAST. This is not a new rule — it is `upsertSnapshotByDate` in
// mutate.ts, which has enforced one balance per date on every write since
// 2026-10-02, applied retroactively to data written before it existed. "As
// of the 28th the account held X" is a statement about a date; two answers
// are a contradiction, and the later one is the correction.
//
// Found by the entity backfill, not by the round-trip property: duplicate
// keys survive happily in an in-memory array, so assembleState put both
// back and the identity held. Only the database's primary key rejects them
// (Postgres 21000, "ON CONFLICT DO UPDATE command cannot affect row a
// second time"). An invariant that lives in a mutator can be bypassed by
// data that predates the mutator.
function mapValues<T>(map: Record<string, T>, fn: (v: T) => T): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) out[k] = fn(v);
  return out;
}

// Migration 13: strip the retired palette index. A typed helper rather
// than an inline cast, because this runs over every category of every
// load and a silent `any` here is how a field comes back.
function stripRetiredColor(cat: TrackerCategory): TrackerCategory {
  const next: Record<string, unknown> = { ...cat };
  delete next.color;
  return next as unknown as TrackerCategory;
}

function dedupeByDate(list: BalanceSnapshot[]): BalanceSnapshot[] {
  const byDate = new Map<string, BalanceSnapshot>();
  for (const s of list) byDate.set(s.date, s); // later wins, as a correction
  return [...byDate.values()];
}

// Migration 10 (2026-10-02): drop per-owner containers that hold nothing.
// `monthlyActuals: { itemId: {} }` and `balanceSnapshots: { catId: [] }` are
// residue — deleting the last entry under an owner used to leave the owner
// behind, where it then rode along in every save forever. Nothing in the app
// enumerates these maps by key, so an empty container is indistinguishable
// from absence to every reader; it was only ever distinguishable to a
// byte-comparison. Found by running the entity round-trip over a real blob:
// splitState emits no row for an empty container, so assembleState could not
// put one back, and the identity failed on data no fixture contained.
function pruneEmpty<T extends Record<string, unknown[] | Record<string, unknown>>>(map: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(map)) {
    const size = Array.isArray(v) ? v.length : Object.keys(v ?? {}).length;
    if (size > 0) out[k as keyof T] = v as T[keyof T];
  }
  return out;
}

export function normalize(parsed: RawState): BudgetState;
// The implementation signature is intentionally `any`. Callers get the precise
// RawState -> BudgetState contract above; the body below is untouched, so the
// seven migrations run on exactly the code that has been shipping and asserted
// against, rather than on code edited to satisfy a compiler.
export function normalize(parsed: any): BudgetState {
  const base = blankState();
  const settings = { ...base.settings, ...(parsed.settings || {}) };
  // Migration + repair: an account saved before tabs were reorderable has no
  // tabOrder at all, and a saved one can name a tab that no longer exists (or
  // miss one added since). Runs every load, so it's self-healing.
  settings.tabOrder = sanitizeTabOrder(settings.tabOrder);

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
  const trackerCategories = trackerCategoriesRaw.map((c: any) => ({ ...c, kind: inferCategoryKind(c) }));

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
  const stamp = (it: any) => (it.accountId ? it : { ...it, accountId: primaryId });

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

  // Phase 2: the Phase 1 rollback mirror (settings.checkInBalance/
  // checkInDate written back from accounts[0]) is retired. The legacy READ
  // path above stays forever — a never-migrated state still builds its
  // account from those fields — but they're stripped from the saved blob
  // now that accounts[0] is the only source of truth. Stated plainly: a
  // rollback to the Phase 1 build is still fine (it knows accounts); a
  // rollback two releases back (pre-Phase 1) would not see the balance.
  delete settings.checkInBalance;
  delete settings.checkInDate;

  // Migration (loan model): loan terms used to live on the PAYMENT item
  // (originalPrincipal/interestRate/interestStartDate on a recurring rule).
  // A loan is now its debt-kind CATEGORY, exactly like an asset category —
  // the terms move onto it, the item stays as a plain payment tagged to it.
  // - The first configured item in a category migrates onto that category.
  // - Any additional configured item in the SAME category (or one whose
  //   category is missing / not debt-kind) spawns its own debt category —
  //   named after it, deterministic id — and is retagged. Nothing dropped.
  // - Balance anchor: an existing user-logged snapshot on the category is
  //   kept untouched. If there's none, one REAL fact is seeded —
  //   originalPrincipal as of the payment's start date ("on this date the
  //   balance was $X") — which reproduces the old projection exactly. A
  //   "today" snapshot is never fabricated (a number the user never saw,
  //   and it would break normalize's purity).
  // Idempotent (items come out stripped, so a second pass is a no-op) and
  // deterministic (fixed ids, no uid()).
  const cats = trackerCategories.map((c: any) => ({ ...c }));
  const catById = new Map<string, any>(cats.map((c: any) => [c.id, c]));
  const balanceSnapshotsOut = { ...(parsed.balanceSnapshots || {}) };
  const nextCatOrder = () => (cats.length ? Math.max(...cats.map((c: any) => c.order ?? 0)) + 1 : 0);
  const migrateLoanItem = (it: any) => {
    if (it.originalPrincipal == null && it.interestRate == null && it.interestStartDate == null) return it;
    const { originalPrincipal, interestRate, interestStartDate, ...rest } = it;
    if (originalPrincipal == null) return rest; // stray rate with no principal: nothing to carry
    let cat = catById.get(rest.category);
    const terms = { originalPrincipal, interestRate: interestRate ?? null, interestStartDate: interestStartDate ?? null };
    if (!cat || cat.kind !== "debt" || cat.originalPrincipal != null) {
      const spawned = { id: `loan-${rest.id}`, name: rest.name, order: nextCatOrder(), kind: "debt", ...terms };
      cats.push(spawned);
      catById.set(spawned.id, spawned);
      cat = spawned;
      rest.category = spawned.id;
    } else {
      Object.assign(cat, terms);
    }
    if (!balanceSnapshotsOut[cat.id]?.length) {
      balanceSnapshotsOut[cat.id] = [{ id: `seed-loan-${cat.id}`, date: rest.startDate ?? rest.date, amount: originalPrincipal }];
    }
    return rest;
  };

  // Migration 8 strips the retired field explicitly: `...parsed` below
  // would otherwise carry `paidOverrides` forward in every saved blob
  // forever, long after the last line that reads it is gone.
  const carried = { ...parsed };
  delete carried.paidOverrides;

  return {
    ...base,
    ...carried,
    settings,
    accounts,
    recurring: recurring.map(stamp).map(migrateLoanItem),
    oneoffs: oneoffs.map(stamp).map(migrateLoanItem),
    // Migration 13: the retired `color` index is stripped here rather than
    // merely ignored, for the same reason paidOverrides was.
    trackerCategories: cats.map(stripRetiredColor),
    // Migration 8 (2026-10-02): the old `paidOverrides` field is DROPPED,
    // not carried forward. Mark-a-bill-paid is gone — a paid bill is already
    // inside the verified balance, and buildEvents drops everything before
    // balanceAsOf, so the flag was a second mechanism doing a job the anchor
    // already does. Nothing reads it any more, so it is simply not copied.
    //
    // Brand-new fields, no legacy shape to fold in — an existing account
    // simply never had any actuals logged yet.
    balanceSnapshots: pruneEmpty(mapValues(balanceSnapshotsOut, dedupeByDate)),
    monthlyActuals: pruneEmpty(parsed.monthlyActuals || {}),
    // Migration 9 (2026-10-02): per-occurrence overrides. A brand-new field,
    // so absent → {}. Nothing is backfilled: an override is a deliberate
    // statement about one date and there is nothing in a prior state that
    // could imply one.
    overrides: pruneEmpty(parsed.overrides || {}),
    // Contributions logged by hand (or, later, imported). Absent on every
    // account that predates the feature — an empty log is the correct and
    // honest starting point, since we can't know what was contributed before
    // anyone was recording it. Deliberately NOT backfilled from ledger
    // transactions: those are a forecast.
    contributionLog: pruneEmpty(parsed.contributionLog || {}),
    accountSnapshots: pruneEmpty(mapValues(accountSnapshots, dedupeByDate)),
  };
}
