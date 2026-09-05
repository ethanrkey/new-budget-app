// ---- Pure state transitions for create / update / delete of budget items ----
// UI-free so the future iOS app reuses them. An "item" is a RecurringRule (has
// a `cadence`) or a OneOff (has a `date`).

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
  const next = { ...item, order: item.order ?? existing?.order ?? nextOrder(state) };

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

// Toggle a "paid this month" override for an item. `monthKey` is "YYYY-MM".
export function togglePaidOverride(state, itemId, monthKey) {
  const current = state.paidOverrides?.[monthKey] || [];
  const next = current.includes(itemId)
    ? current.filter((id) => id !== itemId)
    : [...current, itemId];
  return { ...state, paidOverrides: { ...state.paidOverrides, [monthKey]: next } };
}
