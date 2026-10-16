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
  { key: "oneoff", label: "ONE-OFF / SEASONAL" },
  { key: "saving", label: "INVESTING / SAVING / DEBT" },
];

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

export interface BudgetLayout {
  otherIncomeNames: string[];
  sectionItems: Record<SectionKey, string[]>;
  /** sectionItems.saving, split into one array per tracker category. */
  savingGroups: string[][];
  nameCat: Record<string, CategoryRef>;
  nameOrder: Record<string, number>;
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
// - otherIncomeNames: non-paycheck income rows, in manual order
// - sectionItems: { bill, saving, oneoff } -> names in display order
// - savingGroups: sectionItems.saving split into one array per tracker
//   category, in the user's own category order (the investing/saving/debt
//   section clusters by
//   category first per the spec; `order` only breaks ties within a
//   cluster, and reordering never crosses a cluster boundary). An orphaned
//   category (deleted, or absent for any reason) gets its own trailing
//   "Uncategorized" cluster rather than being dropped.
// - nameCat / nameOrder: name -> its category / manual order, for callers
//   that need to know which reorder group a name belongs to
export function computeBudgetLayout(
  budget: BudgetColumn[],
  trackerCategories: TrackerCategory[] = []
): BudgetLayout {
  const sectionItems = { bill: [], saving: [], oneoff: [] } as Record<SectionKey, string[]>;
  const otherIncomeNames: string[] = [];
  const nameCat: Record<string, CategoryRef> = {};
  const nameOrder: Record<string, number> = {};

  for (const col of budget) {
    for (const [name, obj] of Object.entries(col.expenseItems)) {
      const secKey = sectionFor(obj.category);
      if (!sectionItems[secKey].includes(name)) sectionItems[secKey].push(name);
      nameCat[name] = obj.category;
      nameOrder[name] = obj.order ?? 0;
    }
    for (const [name, obj] of Object.entries(col.otherInItems || {})) {
      if (!otherIncomeNames.includes(name)) otherIncomeNames.push(name);
      nameOrder[name] = obj.order ?? 0;
    }
  }

  // `?? 0` only where the compiler cannot see that every name was just
  // written into nameOrder above — the runtime result is unchanged.
  const ord = (n: string) => nameOrder[n] ?? 0;
  otherIncomeNames.sort((a, b) => ord(a) - ord(b));
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
    const catDiff = clusterIndex(nameCat[a]) - clusterIndex(nameCat[b]);
    return catDiff !== 0 ? catDiff : ord(a) - ord(b);
  });
  const savingGroups: string[][] = [...catOrder, null] // null = the trailing orphaned-category cluster
    .map((cat) => sectionItems.saving.filter((n) => (cat === null ? clusterIndex(nameCat[n]) === catOrder.length : nameCat[n] === cat)))
    .filter((g) => g.length > 0);

  return { otherIncomeNames, sectionItems, savingGroups, nameCat, nameOrder };
}
