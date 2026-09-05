// ---- Shared layout for the Budget grid ----
// Which rows exist, in what order, grouped into which section. Used by both
// BudgetView (to render) and the CSV exporter (to match exactly what's on
// screen) — one source of truth instead of two copies that can drift apart.

export const BUDGET_SECTIONS = [
  { key: "bill", label: "FIXED / RECURRING", cats: ["bill"] },
  { key: "saving", label: "SAVING / DEBT", cats: ["roth", "saved", "brokerage", "loans"] },
  { key: "oneoff", label: "ONE-OFF / SEASONAL", cats: ["oneoff"] },
];

// category -> section key
const CAT_TO_SECTION = {};
for (const sec of BUDGET_SECTIONS) for (const c of sec.cats) CAT_TO_SECTION[c] = sec.key;

// From computeBudget()'s output, work out:
// - otherIncomeNames: non-paycheck income rows, in manual order
// - sectionItems: { bill, saving, oneoff } -> names in display order
// - savingGroups: sectionItems.saving split into [roth[], saved[], brokerage[], loans[]]
//   (SAVING / DEBT clusters by category first per the spec; order only breaks
//   ties within a cluster, and reordering never crosses a cluster boundary)
// - nameCat / nameOrder: name -> its category / manual order, for callers that
//   need to know which reorder group a name belongs to
export function computeBudgetLayout(budget) {
  const sectionItems = {};
  for (const sec of BUDGET_SECTIONS) sectionItems[sec.key] = [];
  const otherIncomeNames = [];
  const nameCat = {};
  const nameOrder = {};

  for (const col of budget) {
    for (const [name, obj] of Object.entries(col.expenseItems)) {
      const secKey = CAT_TO_SECTION[obj.category] || "oneoff";
      if (!sectionItems[secKey].includes(name)) sectionItems[secKey].push(name);
      nameCat[name] = obj.category;
      nameOrder[name] = obj.order ?? 0;
    }
    for (const [name, obj] of Object.entries(col.otherInItems || {})) {
      if (!otherIncomeNames.includes(name)) otherIncomeNames.push(name);
      nameOrder[name] = obj.order ?? 0;
    }
  }

  otherIncomeNames.sort((a, b) => nameOrder[a] - nameOrder[b]);
  sectionItems.bill.sort((a, b) => nameOrder[a] - nameOrder[b]);
  sectionItems.oneoff.sort((a, b) => nameOrder[a] - nameOrder[b]);

  const savingCats = BUDGET_SECTIONS.find((s) => s.key === "saving").cats;
  sectionItems.saving.sort((a, b) => {
    const catDiff = savingCats.indexOf(nameCat[a]) - savingCats.indexOf(nameCat[b]);
    return catDiff !== 0 ? catDiff : nameOrder[a] - nameOrder[b];
  });
  const savingGroups = savingCats.map((cat) => sectionItems.saving.filter((n) => nameCat[n] === cat));

  return { otherIncomeNames, sectionItems, savingGroups, nameCat, nameOrder };
}
