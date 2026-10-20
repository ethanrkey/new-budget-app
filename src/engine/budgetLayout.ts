// ---- Shared layout for the Budget grid ----
// Which rows exist, in what order, grouped into which section. Used by both
// BudgetView (to render) and the CSV exporter (to match exactly what's on
// screen) — one source of truth instead of two copies that can drift apart.

import type { BudgetColumn, CategoryRef, TrackerCategory } from "./types.ts";

export type SectionKey = "bill" | "saving" | "oneoff";

/**
 * The sections, IN DISPLAY ORDER. Everything that draws them reads
 * this array straight through — the web grid, the phone's grid and
 * the CSV export.
 *
 * It did not use to be the order, and the result was three different
 * answers to the same question: the web rendered BUDGET_SECTIONS[0]
 * then [2] and hand-rolled saving last, the phone iterated the array
 * and so put saving second, and the CSV hard-coded a third sequence
 * while its own comment claimed to "match exactly what's on screen".
 * Reported from a device: the two clients disagreed about where
 * savings goes.
 *
 * The order itself is money leaving in descending certainty. Fixed
 * bills are what you owe whatever happens. One-offs are real but
 * occasional. Saving and debt payments are the part you can move when
 * the first two squeeze — so they sit nearest the totals they are
 * competing for.
 */
export const BUDGET_SECTIONS: ReadonlyArray<{ key: SectionKey; label: string }> = [
  { key: "bill", label: "FIXED / RECURRING" },
  { key: "oneoff", label: "ONE-OFF" },
  { key: "saving", label: "INVESTING / SAVING / DEBT" },
];

/**
 * What the one-off section was called before 2026-10-20:
 * "ONE-OFF / SEASONAL".
 *
 * The category itself is called "One-off" in every other place that
 * names it — the planned-spending rows, the transaction form, the
 * calendar — and the heading was the one survivor of an older name.
 * "Seasonal" was never a separate thing you could pick; it was a
 * gloss on "one-off", and a heading that glosses a word the rest of
 * the app uses plainly reads as a fourth category.
 *
 * Kept, not deleted, for the same reason as the saving one below:
 * it is in every CSV anybody has already exported.
 */
export const LEGACY_ONEOFF_SECTION_LABEL = "ONE-OFF / SEASONAL";

/**
 * What this section was called before 2026-10-16: "SAVING / DEBT".
 *
 * It holds investments too — a Roth IRA lands here, because
 * `sectionFor` sends every tracker category that is not a bill or a
 * one-off to this section — and the heading did not say so. Renamed
 * on the owner's call, in setup's own order: investing, saving, debt.
 * The rows inside it already cluster in that order.
 *
 * THE OLD LABEL IS KEPT, not deleted, because it is in every CSV
 * anybody has already exported. The importer accepts both (see
 * `csvImport.ts`); the exporter only ever writes the new one.
 */
export const LEGACY_SAVING_SECTION_LABEL = "SAVING / DEBT";

/**
 * One row of the grid: which item it is, and what to print for it.
 *
 * IT USED TO BE A BARE NAME, everywhere — the row list, the drag
 * groups, the reorder calls, the map key into each column. Two items
 * may share a name, and then they shared a row: a one-off "Discover
 * Bill" and a monthly "Discover Bill" were listed twice and printed
 * the same figures both times. The key is the item's id now and the
 * name is only ever a label.
 */
export interface BudgetRow {
  /** The item's id. Unique; what every column is keyed by. */
  key: string;
  /** What to print. May be shared with another row, legitimately. */
  name: string;
}

export interface BudgetLayout {
  otherIncome: BudgetRow[];
  sectionItems: Record<SectionKey, BudgetRow[]>;
  /** sectionItems.saving, split into one array per tracker category. */
  savingGroups: BudgetRow[][];
  rowCat: Record<string, CategoryRef>;
  rowOrder: Record<string, number>;
}

// Which section a category belongs to. "bill" and "oneoff" are the only
// fixed expense categories; everything else (any user-defined tracker
// category, and an orphaned/deleted one) is a Saving/Debt row by definition
// — there's nowhere else for it to go.
function sectionFor(category: CategoryRef): SectionKey {
  if (category === "bill") return "bill";
  if (category === "oneoff") return "oneoff";
  return "saving";
}

// From computeBudget()'s output plus the user's own trackerCategories list
// (for cluster order — see savingGroups below), work out:
// - otherIncome: one-time income rows, in manual order (recurring
//   income is the take-home row — see computeBudget)
// - sectionItems: { bill, saving, oneoff } -> rows in display order
// - savingGroups: sectionItems.saving split into one array per tracker
//   category, in the user's own category order (the investing/saving/debt
//   section clusters by
//   category first per the spec; `order` only breaks ties within a
//   cluster, and reordering never crosses a cluster boundary). An orphaned
//   category (deleted, or absent for any reason) gets its own trailing
//   "Uncategorized" cluster rather than being dropped.
// - rowCat / rowOrder: item id -> its category / manual order, for callers
//   that need to know which reorder group a row belongs to
export function computeBudgetLayout(
  budget: BudgetColumn[],
  trackerCategories: TrackerCategory[] = []
): BudgetLayout {
  const sectionItems = { bill: [], saving: [], oneoff: [] } as Record<SectionKey, BudgetRow[]>;
  const otherIncome: BudgetRow[] = [];
  const rowCat: Record<string, CategoryRef> = {};
  const rowOrder: Record<string, number> = {};

  // A row exists if any month has it; `seen` is what keeps one item from
  // being listed once per column it appears in. By id — the thing that
  // used to be a name check, and so used to fold two items together.
  const seen = new Set<string>();
  for (const col of budget) {
    for (const [id, obj] of Object.entries(col.expenseItems)) {
      const secKey = sectionFor(obj.category);
      if (!seen.has(id)) { seen.add(id); sectionItems[secKey].push({ key: id, name: obj.name }); }
      rowCat[id] = obj.category;
      rowOrder[id] = obj.order ?? 0;
    }
    for (const [id, obj] of Object.entries(col.otherInItems || {})) {
      if (!seen.has(id)) { seen.add(id); otherIncome.push({ key: id, name: obj.name }); }
      rowOrder[id] = obj.order ?? 0;
    }
  }

  // `?? 0` only where the compiler cannot see that every id was just
  // written into rowOrder above — the runtime result is unchanged.
  const ord = (r: BudgetRow) => rowOrder[r.key] ?? 0;
  otherIncome.sort((a, b) => ord(a) - ord(b));
  sectionItems.bill.sort((a, b) => ord(a) - ord(b));
  sectionItems.oneoff.sort((a, b) => ord(a) - ord(b));

  // Sort by `.order` rather than trusting the array's own position — moving
  // a category (mutate.ts's moveCategory) only swaps `.order` values, it
  // never reshuffles the array itself, so `.order` is always the source of
  // truth for display sequence, never array index.
  const catOrder = [...trackerCategories].sort((a, b) => a.order - b.order).map((c) => c.id);
  const clusterIndex = (cat: CategoryRef | undefined) => {
    const i = cat === undefined ? -1 : catOrder.indexOf(cat);
    return i < 0 ? catOrder.length : i; // unknown/orphaned categories cluster last, together
  };
  sectionItems.saving.sort((a, b) => {
    const catDiff = clusterIndex(rowCat[a.key]) - clusterIndex(rowCat[b.key]);
    return catDiff !== 0 ? catDiff : ord(a) - ord(b);
  });
  const savingGroups: BudgetRow[][] = [...catOrder, null] // null = the trailing orphaned-category cluster
    .map((cat) => sectionItems.saving.filter((r) => (cat === null ? clusterIndex(rowCat[r.key]) === catOrder.length : rowCat[r.key] === cat)))
    .filter((g) => g.length > 0);

  return { otherIncome, sectionItems, savingGroups, rowCat, rowOrder };
}
