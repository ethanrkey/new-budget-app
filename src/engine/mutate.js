// ---- Pure state transitions for create / update / delete of budget items ----
// UI-free so the future iOS app reuses them. An "item" is a RecurringRule (has
// a `cadence`) or a OneOff (has a `date`).
import { uid, primaryAccount } from "./model.js";

// Insert a new item or replace an existing one (matched by id).
// - No type change  -> replace in place, preserving list position.
// - One-off <-> recurring switch, or brand-new -> drop from both lists, append
//   to the correct one.
// - `order` is kept from the incoming item, else the existing one, else assigned.
export function upsertItem(state, item) {
  const isRecurring = !!item.cadence;
  const existing =
    state.recurring.find((r) => r.id === item.id) ||
    state.oneoffs.find((o) => o.id === item.id) ||
    null;
  // Every item belongs to an account. With one account today, anything that
  // arrives without one (EventForm, QuickEntry, the CSV importers,
  // Onboarding) is stamped with the primary account silently — no account
  // picker in the UI until there's more than one to pick from.
  const next = {
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
export function deleteItem(state, id) {
  return {
    ...state,
    recurring: state.recurring.filter((r) => r.id !== id),
    oneoffs: state.oneoffs.filter((o) => o.id !== id),
  };
}

// Remove several items (recurring rules and/or one-offs) at once, by id —
// used by multi-select delete. One atomic state update instead of N separate
// deleteItem calls.
export function deleteItems(state, ids) {
  const idSet = new Set(ids);
  return {
    ...state,
    recurring: state.recurring.filter((r) => !idSet.has(r.id)),
    oneoffs: state.oneoffs.filter((o) => !idSet.has(o.id)),
  };
}

// Find the raw item behind a given id (ledger row ids are "<itemId>@<date>").
export function findItem(state, id) {
  return (
    state.recurring.find((r) => r.id === id) ||
    state.oneoffs.find((o) => o.id === id) ||
    null
  );
}

// All items that carry exactly this name (used to edit from a Budget row).
export function itemsByName(state, name) {
  return [...state.recurring, ...state.oneoffs].filter((it) => it.name === name);
}

function nextOrder(state) {
  const all = [...state.recurring, ...state.oneoffs];
  return all.reduce((m, x) => Math.max(m, x.order ?? 0), -1) + 1;
}

// Swap the `order` of every item named nameA with every item named nameB —
// used by the Budget's manual up/down reordering (names are 1:1 with an item
// in normal use).
export function swapOrder(state, nameA, nameB) {
  const orderOf = (name) =>
    (state.recurring.find((it) => it.name === name) ||
      state.oneoffs.find((it) => it.name === name))?.order ?? 0;
  const orderA = orderOf(nameA);
  const orderB = orderOf(nameB);
  const swap = (it) => {
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
export function reorderList(state, names, name, beforeName) {
  const rest = names.filter((n) => n !== name);
  const insertAt = beforeName ? rest.indexOf(beforeName) : rest.length;
  const next = insertAt < 0 ? [...rest, name] : [...rest.slice(0, insertAt), name, ...rest.slice(insertAt)];

  const orderOf = new Map(next.map((n, i) => [n, i]));
  const patch = (it) => (orderOf.has(it.name) ? { ...it, order: orderOf.get(it.name) } : it);
  return {
    ...state,
    recurring: state.recurring.map(patch),
    oneoffs: state.oneoffs.map(patch),
  };
}

// ---- Tracker category (savings/debt/investment) CRUD ----
// Deleting a category never touches items that reference it — an orphaned
// category id just renders as a neutral "Uncategorized" (see
// budgetLayout.js / CATEGORY_PALETTE's fallback color) rather than blocking
// the delete or silently reassigning someone's data.

export function addCategory(state, name, color, kind = "asset") {
  const order = state.trackerCategories.length
    ? Math.max(...state.trackerCategories.map((c) => c.order)) + 1
    : 0;
  return { ...state, trackerCategories: [...state.trackerCategories, { id: uid(), name, color, order, kind }] };
}

export function updateCategory(state, id, patch) {
  return {
    ...state,
    trackerCategories: state.trackerCategories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}

export function deleteCategory(state, id) {
  return { ...state, trackerCategories: state.trackerCategories.filter((c) => c.id !== id) };
}

// Swap a category's order with its immediate neighbor (direction -1 or +1) —
// simple up/down reordering, same spirit as the Budget's row arrows.
export function moveCategory(state, id, direction) {
  const sorted = [...state.trackerCategories].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((c) => c.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= sorted.length) return state;
  const a = sorted[i], b = sorted[j];
  return {
    ...state,
    trackerCategories: state.trackerCategories.map((c) => {
      if (c.id === a.id) return { ...c, order: b.order };
      if (c.id === b.id) return { ...c, order: a.order };
      return c;
    }),
  };
}

// Toggle a "paid this month" override for an item. `monthKey` is "YYYY-MM".
export function togglePaidOverride(state, itemId, monthKey) {
  const current = state.paidOverrides?.[monthKey] || [];
  const next = current.includes(itemId)
    ? current.filter((id) => id !== itemId)
    : [...current, itemId];
  return { ...state, paidOverrides: { ...state.paidOverrides, [monthKey]: next } };
}

// ---- Fund-balance snapshots (Dashboard "actual" balances) ----
// Every logged value is fully editable/deletable after the fact — these are
// corrections to your own record-keeping, not an append-only audit log.

export function addBalanceSnapshot(state, categoryId, amount, date) {
  const list = state.balanceSnapshots?.[categoryId] || [];
  return {
    ...state,
    balanceSnapshots: { ...state.balanceSnapshots, [categoryId]: [...list, { id: uid(), date, amount }] },
  };
}

export function updateBalanceSnapshot(state, categoryId, snapshotId, patch) {
  const list = state.balanceSnapshots?.[categoryId] || [];
  return {
    ...state,
    balanceSnapshots: {
      ...state.balanceSnapshots,
      [categoryId]: list.map((s) => (s.id === snapshotId ? { ...s, ...patch } : s)),
    },
  };
}

export function deleteBalanceSnapshot(state, categoryId, snapshotId) {
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

export function setMonthlyActual(state, itemId, monthKey, amount) {
  return {
    ...state,
    monthlyActuals: {
      ...state.monthlyActuals,
      [itemId]: { ...(state.monthlyActuals?.[itemId] || {}), [monthKey]: amount },
    },
  };
}

export function deleteMonthlyActual(state, itemId, monthKey) {
  const forItem = { ...(state.monthlyActuals?.[itemId] || {}) };
  delete forItem[monthKey];
  return { ...state, monthlyActuals: { ...state.monthlyActuals, [itemId]: forItem } };
}

// ---- Account balance updates (the "Update balance" confirm flow) ----
// ONE atomic transition: the account's verified balance + its as-of date, a
// history snapshot, AND the legacy settings mirror (rollback safety net —
// see stateShape.js). Never partial: a half-applied update would desync the
// balance chain from its own anchor date. Nothing here runs until the user
// clicks Confirm — the modal holds drafts, this commits.
export function updateAccountBalance(state, accountId, amount, date) {
  const accounts = state.accounts.map((a) =>
    a.id === accountId ? { ...a, balance: amount, balanceAsOf: date } : a
  );
  const list = state.accountSnapshots?.[accountId] || [];
  // (Phase 1 also wrote a settings.checkInBalance/checkInDate mirror here as
  // a rollback safety net — retired in Phase 2; accounts[0] is the only
  // source of truth, see stateShape.js.)
  return {
    ...state,
    accounts,
    accountSnapshots: { ...state.accountSnapshots, [accountId]: [...list, { id: uid(), date, amount }] },
  };
}

// Account history is editable/deletable like every other logged value. The
// account's live `balance` stays authoritative on its own — editing an old
// snapshot corrects the record, it doesn't retroactively move the anchor.
export function updateAccountSnapshot(state, accountId, snapshotId, patch) {
  const list = state.accountSnapshots?.[accountId] || [];
  return {
    ...state,
    accountSnapshots: {
      ...state.accountSnapshots,
      [accountId]: list.map((s) => (s.id === snapshotId ? { ...s, ...patch } : s)),
    },
  };
}

export function deleteAccountSnapshot(state, accountId, snapshotId) {
  const list = state.accountSnapshots?.[accountId] || [];
  return {
    ...state,
    accountSnapshots: { ...state.accountSnapshots, [accountId]: list.filter((s) => s.id !== snapshotId) },
  };
}

// ---- Loan setup (the Dashboard's "Set up loan" / "+ Add loan" flow) ----
// A loan IS a debt-kind category (see engine/loans.js). ONE atomic transition:
// create the category if it doesn't exist yet, write its terms, and — for a
// brand-new loan — log its current outstanding balance as the first
// snapshot. Never creates a transaction; payments are added separately and
// just tag this category. Editing terms later passes no `outstanding`.
// Create (or rename/recolor) a savings/investment category and, for a new
// one, log the balance it has today in the same step — the anchor every
// projection on its Dashboard card measures from. The asset mirror of
// setupLoan(): one atomic mutation, no transaction created. Contributions are
// ordinary transactions that pick this category.
export function setupAsset(state, { categoryId = null, name, color = null, balance = null, asOf = null }) {
  let next = state;
  let id = categoryId;
  if (!id || !next.trackerCategories.some((c) => c.id === id)) {
    next = addCategory(next, name, color ?? 0, "asset");
    id = next.trackerCategories[next.trackerCategories.length - 1].id;
  }
  const patch = { kind: "asset" };
  if (name) patch.name = name;
  if (color != null) patch.color = color;
  next = updateCategory(next, id, patch);
  if (balance != null && asOf) next = addBalanceSnapshot(next, id, balance, asOf);
  return next;
}

export function setupLoan(state, { categoryId = null, name, color = null, originalPrincipal, interestRate = null, interestStartDate = null, outstanding = null, asOf = null }) {
  let next = state;
  let id = categoryId;
  if (!id || !next.trackerCategories.some((c) => c.id === id)) {
    next = addCategory(next, name, color ?? 3, "debt");
    id = next.trackerCategories[next.trackerCategories.length - 1].id;
  }
  const patch = { kind: "debt", originalPrincipal, interestRate, interestStartDate };
  if (name) patch.name = name;
  if (color != null) patch.color = color;
  next = updateCategory(next, id, patch);
  if (outstanding != null && asOf) next = addBalanceSnapshot(next, id, outstanding, asOf);
  return next;
}
