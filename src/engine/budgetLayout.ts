// ---- Shared layout for the Budget grid ----
// Which rows exist, in what order, grouped into which section. Used by both
// BudgetView (to render) and the CSV exporter (to match exactly what's on
// screen) — one source of truth instead of two copies that can drift apart.

import type { BudgetColumn, CategoryRef, TrackerCategory } from "./types.ts";

export type SectionKey = "bill" | "saving" | "oneoff";

export const BUDGET_SECTIONS: ReadonlyArray<{ key: SectionKey; label: string }> = [
  { key: "bill", label: "FIXED / RECURRING" },
  { key: "saving", label: "SAVING / DEBT" },
  { key: "oneoff", label: "ONE-OFF / SEASONAL" },
];

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
//   category, in the user's own category order (SAVING / DEBT clusters by
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
  // a category (mutate.js's moveCategory) only swaps `.order` values, it
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
