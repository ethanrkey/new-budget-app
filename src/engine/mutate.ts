// ---- Pure state transitions for create / update / delete of budget items ----
// UI-free so the future iOS app reuses them. An "item" is a RecurringRule (has
// a `cadence`) or a OneOff (has a `date`).
import { uid, primaryAccount, sanitizeTabOrder, blankState } from "./model.ts";
import { occurrenceDates } from "./generate.ts";
import type {
  AssetCategory, BalanceSnapshot, BudgetItem, BudgetState, Contribution, DebtCategory,
  AssetKind, ISODate, MonthKey, RecurringItem, TabId,
} from "./types.ts";

/**
 * A partial update to a tracker category. Spans both variants on purpose:
 * setupLoan/setupAsset flip `kind` and write the terms in one patch, so the
 * patch is legitimately wider than either variant alone.
 */
// Spelled out per variant rather than Omit<TrackerCategory,...>: Omit over a
// union keeps only the COMMON keys, which would silently drop the loan terms.
export type CategoryPatch =
  Partial<Omit<AssetCategory, "kind">> &
  Partial<Omit<DebtCategory, "kind">> &
  { kind?: "asset" | "debt" };

// Insert a new item or replace an existing one (matched by id).
// - No type change  -> replace in place, preserving list position.
// - One-off <-> recurring switch, or brand-new -> drop from both lists, append
//   to the correct one.
// - `order` is kept from the incoming item, else the existing one, else assigned.
export function upsertItem(state: BudgetState, item: BudgetItem): BudgetState {
  const isRecurring = !!("cadence" in item && item.cadence);
  const existing =
    state.recurring.find((r) => r.id === item.id) ||
    state.oneoffs.find((o) => o.id === item.id) ||
    null;
  // Every item belongs to an account. With one account today, anything that
  // arrives without one (EventForm, QuickEntry, the CSV importers,
  // Onboarding) is stamped with the primary account silently — no account
  // picker in the UI until there's more than one to pick from.
  // `any`: this spread legitimately produces either variant of BudgetItem
  // depending on the incoming shape, and narrowing it here would mean
  // branching logic that does not exist today.
  const next: any = {
    ...item,
    order: item.order ?? existing?.order ?? nextOrder(state),
    accountId: item.accountId ?? existing?.accountId ?? primaryAccount(state).id,
  };

  if (isRecurring && state.recurring.some((r) => r.id === item.id)) {
    return { ...state, recurring: state.recurring.map((r) => (r.id === item.id ? next : r)) };
  }
  if (!isRecurring && state.oneoffs.some((o) => o.id === item.id)) {
    return { ...state, oneoffs: state.oneoffs.map((o) => (o.id === item.id ? next : o)) };
  }

  const recurring = state.recurring.filter((r) => r.id !== item.id);
  const oneoffs = state.oneoffs.filter((o) => o.id !== item.id);
  return isRecurring
    ? { ...state, recurring: [...recurring, next], oneoffs }
    : { ...state, recurring, oneoffs: [...oneoffs, next] };
}

// Remove an item (recurring rule or one-off) by id from wherever it lives.
export function deleteItem(state: BudgetState, id: string): BudgetState {
  return {
    ...state,
    recurring: state.recurring.filter((r) => r.id !== id),
    oneoffs: state.oneoffs.filter((o) => o.id !== id),
    overrides: withoutKeys(state.overrides, [id]),
  };
}

// Remove several items (recurring rules and/or one-offs) at once, by id —
// used by multi-select delete. One atomic state update instead of N separate
// deleteItem calls.
export function deleteItems(state: BudgetState, ids: string[]): BudgetState {
  const idSet = new Set(ids);
  return {
    ...state,
    recurring: state.recurring.filter((r) => !idSet.has(r.id)),
    oneoffs: state.oneoffs.filter((o) => !idSet.has(o.id)),
    overrides: withoutKeys(state.overrides, ids),
  };
}

// Deleting a rule takes its overrides with it. This is the OPPOSITE of what
// happens to a transaction tagged to a deleted category, which deliberately
// stays orphaned — and the difference is the point: an orphaned transaction
// is still visible in the Ledger and can be re-filed, while an override
// keyed by a ruleId that no longer exists can never be seen, edited or
// reached again. It is unreachable garbage, not a record.
function withoutKeys<T>(map: Record<string, T> | undefined, keys: string[]): Record<string, T> {
  const next = { ...(map || {}) };
  for (const k of keys) delete next[k];
  return next;
}

// Wipe Data. Deliberately `blankState()` and nothing cleverer: "wipe" has
// to mean a new account, or the flags that make an account feel used —
// hasSeenOnboarding above all — survive it and the app greets a wiped
// account as a returning one. Everything logged goes too; the Settings
// confirmation says so, and Export is one click away in the same modal.
export function wipeToNewAccount(): BudgetState {
  return blankState();
}

// ---- Per-occurrence amount overrides ----
// "Electric is $112 as a rule but $180 in July." Forecast data: the user
// editing the plan for one date, not importing an observation.
export function setOverride(state: BudgetState, ruleId: string, date: ISODate, amount: number): BudgetState {
  return {
    ...state,
    overrides: { ...state.overrides, [ruleId]: { ...(state.overrides?.[ruleId] || {}), [date]: Math.abs(amount) } },
  };
}

export function clearOverride(state: BudgetState, ruleId: string, date: ISODate): BudgetState {
  const forRule = { ...(state.overrides?.[ruleId] || {}) };
  delete forRule[date];
  const overrides = { ...state.overrides };
  // Drop the rule's bucket entirely once it is empty, so a state that has
  // had every override removed is byte-identical to one that never had any.
  if (Object.keys(forRule).length === 0) delete overrides[ruleId];
  else overrides[ruleId] = forRule;
  return { ...state, overrides };
}

// Which of a rule's overrides would stop applying if it were saved as
// `next` — because overrides are keyed by DATE and a rescheduled rule no
// longer lands on them. Nothing here mutates; the UI asks first so the loss
// is never silent, which is the whole reason this is exported.
export function orphanedOverrideDates(state: BudgetState, next: RecurringItem, horizonISO: ISODate): ISODate[] {
  const dates = Object.keys(state.overrides?.[next.id] || {});
  if (dates.length === 0) return [];
  const furthest = dates.reduce((a, b) => (a > b ? a : b));
  const through = furthest > horizonISO ? furthest : horizonISO;
  const stillLands = new Set(occurrenceDates(next, through));
  return dates.filter((d) => !stillLands.has(d)).sort();
}

// Find the raw item behind a given id (ledger row ids are "<itemId>@<date>").
export function findItem(state: BudgetState, id: string): BudgetItem | null {
  return (
    state.recurring.find((r) => r.id === id) ||
    state.oneoffs.find((o) => o.id === id) ||
    null
  );
}

// All items that carry exactly this name (used to edit from a Budget row).
export function itemsByName(state: BudgetState, name: string): BudgetItem[] {
  return [...state.recurring, ...state.oneoffs].filter((it) => it.name === name);
}

function nextOrder(state: BudgetState): number {
  const all = [...state.recurring, ...state.oneoffs];
  return all.reduce((m, x) => Math.max(m, x.order ?? 0), -1) + 1;
}

// Swap the `order` of every item named nameA with every item named nameB —
// used by the Budget's manual up/down reordering (names are 1:1 with an item
// in normal use).
export function swapOrder(state: BudgetState, nameA: string, nameB: string): BudgetState {
  const orderOf = (name: string) =>
    (state.recurring.find((it) => it.name === name) ||
      state.oneoffs.find((it) => it.name === name))?.order ?? 0;
  const orderA = orderOf(nameA);
  const orderB = orderOf(nameB);
  const swap = (it: any) => {
    if (it.name === nameA) return { ...it, order: orderB };
    if (it.name === nameB) return { ...it, order: orderA };
    return it;
  };
  return {
    ...state,
    recurring: state.recurring.map(swap),
    oneoffs: state.oneoffs.map(swap),
  };
}

// Move the item named `name` to sit immediately before the item named
// `beforeName` (or to the end of the group, if `beforeName` is null),
// renumbering `order` sequentially across exactly this list of names — used
// by drag-and-drop. `names` must be the full ordered list of the group being
// reordered within (a section, or a Saving/Debt category cluster) so the
// drag never crosses into a different group.
export function reorderList(state: BudgetState, names: string[], name: string, beforeName: string | null): BudgetState {
  const rest = names.filter((n) => n !== name);
  const insertAt = beforeName ? rest.indexOf(beforeName) : rest.length;
  const next = insertAt < 0 ? [...rest, name] : [...rest.slice(0, insertAt), name, ...rest.slice(insertAt)];

  const orderOf = new Map(next.map((n, i) => [n, i]));
  const patch = (it: any) => (orderOf.has(it.name) ? { ...it, order: orderOf.get(it.name) } : it);
  return {
    ...state,
    recurring: state.recurring.map(patch),
    oneoffs: state.oneoffs.map(patch),
  };
}

// ---- Tracker category (savings/debt/investment) CRUD ----
// Deleting a category never touches items that reference it — an orphaned
// category id just renders as a neutral "Uncategorized" (see
// budgetLayout.ts / CATEGORY_PALETTE's fallback color) rather than blocking
// the delete or silently reassigning someone's data.

/**
 * `color` is no longer chosen or read — colour is derived from what the
 * money does (engine/palette.ts). The parameter stays so existing callers
 * and stored data keep their shape, and a value is still written so a blob
 * round-trips unchanged; nothing paints with it. Removing the field is a
 * separate migration, deliberately not bundled with a visual change.
 */
export function addCategory(state: BudgetState, name: string, kind: "asset" | "debt" = "asset"): BudgetState {
  // A RUNTIME guard on the enum, because the callers that matter are JSX
  // and tsc cannot see them. This exact signature lost a parameter in
  // migration 13 and App.jsx went on passing `0` where `kind` now sits,
  // so every category added from the manager was created with kind === 0
  // — silently, for days. A type is not a guard when half the callers are
  // untyped; this is.
  if (kind !== "asset" && kind !== "debt") {
    throw new Error(`addCategory: kind must be "asset" or "debt", got ${JSON.stringify(kind)}`);
  }
  const order = state.trackerCategories.length
    ? Math.max(...state.trackerCategories.map((c) => c.order)) + 1
    : 0;
  return { ...state, trackerCategories: [...state.trackerCategories, { id: uid(), name, order, kind }] };
}

export function updateCategory(state: BudgetState, id: string, patch: CategoryPatch): BudgetState {
  return {
    ...state,
    trackerCategories: state.trackerCategories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}

export function deleteCategory(state: BudgetState, id: string): BudgetState {
  return { ...state, trackerCategories: state.trackerCategories.filter((c) => c.id !== id) };
}

// Swap a category's order with its immediate neighbor (direction -1 or +1) —
// simple up/down reordering, same spirit as the Budget's row arrows.
export function moveCategory(state: BudgetState, id: string, direction: -1 | 1): BudgetState {
  const sorted = [...state.trackerCategories].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((c) => c.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= sorted.length) return state;
  const a = sorted[i], b = sorted[j];
  return {
    ...state,
    trackerCategories: state.trackerCategories.map((c) => {
      if (c.id === a!.id) return { ...c, order: b!.order };
      if (c.id === b!.id) return { ...c, order: a!.order };
      return c;
    }),
  };
}

// ---- Fund-balance snapshots (Dashboard "actual" balances) ----
// Every logged value is fully editable/deletable after the fact — these are
// corrections to your own record-keeping, not an append-only audit log.

export function addBalanceSnapshot(state: BudgetState, categoryId: string, amount: number, date: ISODate): BudgetState {
  const list = state.balanceSnapshots?.[categoryId] || [];
  return {
    ...state,
    balanceSnapshots: { ...state.balanceSnapshots, [categoryId]: upsertSnapshotByDate(list, date, amount) },
  };
}

export function updateBalanceSnapshot(state: BudgetState, categoryId: string, snapshotId: string, patch: Partial<BalanceSnapshot>): BudgetState {
  const list = state.balanceSnapshots?.[categoryId] || [];
  return {
    ...state,
    balanceSnapshots: {
      ...state.balanceSnapshots,
      [categoryId]: list.map((s) => (s.id === snapshotId ? { ...s, ...patch } : s)),
    },
  };
}

export function deleteBalanceSnapshot(state: BudgetState, categoryId: string, snapshotId: string): BudgetState {
  const list = state.balanceSnapshots?.[categoryId] || [];
  return {
    ...state,
    balanceSnapshots: { ...state.balanceSnapshots, [categoryId]: list.filter((s) => s.id !== snapshotId) },
  };
}

// ---- Monthly actuals (Dashboard "actual vs. budgeted" for variable bills) ----
// Keyed by (itemId, monthKey) rather than any specific dated ledger row —
// deliberately: a variable bill's real total (especially something like
// groceries, an aggregate of many purchases) doesn't correspond to one
// meaningful date the way a fixed bill's due date does. Already fully
// editable/deletable by construction (setting the same key again replaces
// it; there's no separate "list of entries" to prune).

// ---- Logged contributions ----
// Money you actually put in, recorded one entry at a time. Same CRUD shape as
// balance snapshots, and like them every entry stays editable and deletable.
// `source` defaults to "manual"; an importer (Plaid or a bank CSV) writes its
// own source and an `externalId` so re-importing can dedupe instead of
// doubling entries.
export function addContribution(state: BudgetState, categoryId: string, amount: number, date: ISODate, extra: Partial<Contribution> = {}): BudgetState {
  const list = state.contributionLog?.[categoryId] || [];
  return {
    ...state,
    contributionLog: {
      ...state.contributionLog,
      [categoryId]: [...list, { id: uid(), date, amount, source: "manual", ...extra }],
    },
  };
}

export function updateContribution(state: BudgetState, categoryId: string, entryId: string, patch: Partial<Contribution>): BudgetState {
  const list = state.contributionLog?.[categoryId] || [];
  return {
    ...state,
    contributionLog: {
      ...state.contributionLog,
      [categoryId]: list.map((c) => (c.id === entryId ? { ...c, ...patch } : c)),
    },
  };
}

export function deleteContribution(state: BudgetState, categoryId: string, entryId: string): BudgetState {
  const list = state.contributionLog?.[categoryId] || [];
  return {
    ...state,
    contributionLog: { ...state.contributionLog, [categoryId]: list.filter((c) => c.id !== entryId) },
  };
}

// How many transactions are tagged to a category — what the delete confirm
// tells you will be left behind. Counts ITEMS (a recurring rule is one), not
// occurrences: the rule is the thing that survives deletion.
export function countTaggedItems(state: BudgetState, categoryId: string): number {
  const hit = (i: BudgetItem) => i.category === categoryId;
  return state.recurring.filter(hit).length + state.oneoffs.filter(hit).length;
}

export function setMonthlyActual(state: BudgetState, itemId: string, monthKey: MonthKey, amount: number): BudgetState {
  return {
    ...state,
    monthlyActuals: {
      ...state.monthlyActuals,
      [itemId]: { ...(state.monthlyActuals?.[itemId] || {}), [monthKey]: amount },
    },
  };
}

export function deleteMonthlyActual(state: BudgetState, itemId: string, monthKey: MonthKey): BudgetState {
  const forItem = { ...(state.monthlyActuals?.[itemId] || {}) };
  delete forItem[monthKey];
  return { ...state, monthlyActuals: { ...state.monthlyActuals, [itemId]: forItem } };
}

// ---- Account balance updates (the "Update balance" confirm flow) ----
// ONE atomic transition: the account's verified balance + its as-of date, a
// history snapshot, AND the legacy settings mirror (rollback safety net —
// see stateShape.ts). Never partial: a half-applied update would desync the
// balance chain from its own anchor date. Nothing here runs until the user
// clicks Confirm — the modal holds drafts, this commits.
// A balance is a statement about a DATE: "as of the 28th, the account held
// X". Two rows for one date are contradictory, not two observations, so a
// second one corrects the first in place (keeping its id, since it is the
// same observation revised). Real data had Sep 28 logged twice at the same
// figure and Oct 1 holding two different ones.
//
// Contributions are deliberately NOT deduped this way: two deposits on one
// day are two real events, and collapsing them would lose money.
function upsertSnapshotByDate(list: BalanceSnapshot[], date: ISODate, amount: number): BalanceSnapshot[] {
  const at = list.findIndex((s) => s.date === date);
  if (at === -1) return [...list, { id: uid(), date, amount }];
  return list.map((s, i) => (i === at ? { ...s, amount } : s));
}

export function updateAccountBalance(state: BudgetState, accountId: string, amount: number, date: ISODate): BudgetState {
  const accounts = state.accounts.map((a) =>
    a.id === accountId ? { ...a, balance: amount, balanceAsOf: date } : a
  );
  const list = state.accountSnapshots?.[accountId] || [];
  // (Phase 1 also wrote a settings.checkInBalance/checkInDate mirror here as
  // a rollback safety net — retired in Phase 2; accounts[0] is the only
  // source of truth, see stateShape.ts.)
  return {
    ...state,
    accounts,
    accountSnapshots: { ...state.accountSnapshots, [accountId]: upsertSnapshotByDate(list, date, amount) },
  };
}

// Account history is editable/deletable like every other logged value. The
// account's live `balance` stays authoritative on its own — editing an old
// snapshot corrects the record, it doesn't retroactively move the anchor.
export function updateAccountSnapshot(state: BudgetState, accountId: string, snapshotId: string, patch: Partial<BalanceSnapshot>): BudgetState {
  const list = state.accountSnapshots?.[accountId] || [];
  return {
    ...state,
    accountSnapshots: {
      ...state.accountSnapshots,
      [accountId]: list.map((s) => (s.id === snapshotId ? { ...s, ...patch } : s)),
    },
  };
}

export function deleteAccountSnapshot(state: BudgetState, accountId: string, snapshotId: string): BudgetState {
  const list = state.accountSnapshots?.[accountId] || [];
  return {
    ...state,
    accountSnapshots: { ...state.accountSnapshots, [accountId]: list.filter((s) => s.id !== snapshotId) },
  };
}

// ---- Loan setup (the Dashboard's "Set up loan" / "+ Add loan" flow) ----
// A loan IS a debt-kind category (see engine/loans.ts). ONE atomic transition:
// create the category if it doesn't exist yet, write its terms, and — for a
// brand-new loan — log its current outstanding balance as the first
// snapshot. Never creates a transaction; payments are added separately and
// just tag this category. Editing terms later passes no `outstanding`.
// Create (or rename/recolor) a savings/investment category and, for a new
// one, log the balance it has today in the same step — the anchor every
// projection on its Dashboard card measures from. The asset mirror of
// setupLoan(): one atomic mutation, no transaction created. Contributions are
// ordinary transactions that pick this category.
// Drag a tab in front of another one. Pure array move on the sanitized
// order, so a stale stored order can't produce a broken one.
export function moveTab(state: BudgetState, draggedId: TabId, beforeId: TabId | null): BudgetState {
  const order = sanitizeTabOrder(state.settings.tabOrder);
  if (draggedId === beforeId || !order.includes(draggedId)) return state;
  const without = order.filter((t) => t !== draggedId);
  const at = beforeId == null ? without.length : without.indexOf(beforeId);
  const next = at < 0 ? [...without, draggedId] : [...without.slice(0, at), draggedId, ...without.slice(at)];
  return { ...state, settings: { ...state.settings, tabOrder: next } };
}

export interface SetupAssetInput {
  categoryId?: string | null;
  name: string;
  // No `color`. Colour is derived from role as of 2026-10-03, and the field
  // outlived its picker by a few hours: LoanSetupModal still rendered a
  // swatch row whose value setupLoan() then silently dropped on the floor.
  // A control that discards what you type is worse than no control.
  balance?: number | null;
  asOf?: ISODate | null;
  assetKind?: AssetKind | null;
}
export function setupAsset(state: BudgetState, { categoryId = null, name, balance = null, asOf = null, assetKind = null }: SetupAssetInput): BudgetState {
  let next = state;
  let id = categoryId;
  if (!id || !next.trackerCategories.some((c) => c.id === id)) {
    next = addCategory(next, name, "asset");
    id = next.trackerCategories[next.trackerCategories.length - 1]!.id;
  }
  const patch: CategoryPatch = { kind: "asset" };
  if (name) patch.name = name;
  // Only written when answered. Absent stays absent, and absent renders as
  // an investment — which withholds a projected line rather than drawing
  // one over market-exposed value.
  if (assetKind != null) patch.assetKind = assetKind;
  next = updateCategory(next, id, patch);
  if (balance != null && asOf) next = addBalanceSnapshot(next, id, balance, asOf);
  return next;
}

export interface SetupLoanInput extends SetupAssetInput {
  originalPrincipal: number;
  interestRate?: number | null;
  interestStartDate?: ISODate | null;
  outstanding?: number | null;
}
export function setupLoan(state: BudgetState, { categoryId = null, name, originalPrincipal, interestRate = null, interestStartDate = null, outstanding = null, asOf = null }: SetupLoanInput): BudgetState {
  let next = state;
  let id = categoryId;
  if (!id || !next.trackerCategories.some((c) => c.id === id)) {
    next = addCategory(next, name, "debt");
    id = next.trackerCategories[next.trackerCategories.length - 1]!.id;
  }
  const patch: CategoryPatch = { kind: "debt", originalPrincipal, interestRate, interestStartDate };
  if (name) patch.name = name;
  next = updateCategory(next, id, patch);
  if (outstanding != null && asOf) next = addBalanceSnapshot(next, id, outstanding, asOf);
  return next;
}
