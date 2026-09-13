// ---- CSV export: pure string builders, no DOM/File APIs here ----
// (those live in the component that triggers the actual download)
import { CATEGORIES } from "./model.js";
import { computeBudgetLayout } from "./budgetLayout.js";

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells) {
  return cells.map(csvCell).join(",");
}
function fmt(n) {
  return n || n === 0 ? Number(n).toFixed(2) : "";
}

function categoryLabel(cat, trackerCategories) {
  if (CATEGORIES[cat]) return CATEGORIES[cat].label;
  return trackerCategories.find((c) => c.id === cat)?.name ?? cat;
}

// Every ledger row, one per line: date, item, category, in/out, running
// balance, and one cumulative-tracker column per user-defined category
// (blank except on the row that steps it) — matches what's shown on screen
// with the columns open. `trackerCategories` is the user's own list (order
// = column order); pass it explicitly so an export always matches whoever's
// data it came from, not some hardcoded set.
export function ledgerToCSV(ledger, trackerCategories = []) {
  // `.order` is the source of truth for column sequence, not array
  // position — see budgetLayout.js's identical note.
  const cats = [...trackerCategories].sort((a, b) => a.order - b.order);
  const lines = [csvRow(["Date", "Item", "Category", "In", "Out", "Balance", ...cats.map((c) => c.name)])];
  for (const r of ledger.rows) {
    lines.push(csvRow([
      r.date,
      r.name,
      categoryLabel(r.category, cats),
      r.direction === "in" ? fmt(r.amount) : "",
      r.direction === "out" ? fmt(r.amount) : "",
      fmt(r.balance),
      ...cats.map((c) => (r.stepped?.key === c.id ? fmt(r.stepped.value) : "")),
    ]));
  }
  return lines.join("\r\n");
}

// The monthly grid, exactly as sectioned/ordered on screen (same
// computeBudgetLayout() BudgetView renders from) — one row per line, one
// column per month.
export function budgetToCSV(budget, trackerCategories = []) {
  if (budget.length === 0) return "";
  const layout = computeBudgetLayout(budget, trackerCategories);
  const lines = [csvRow(["", ...budget.map((c) => c.label)])];
  const row = (label, pick) => lines.push(csvRow([label, ...budget.map((c) => fmt(pick(c)))]));

  lines.push(csvRow(["INCOME"]));
  row("Starting point", (c) => c.startingPoint);
  row("Take-home", (c) => c.takeHome);
  // A FIXED label, not the account's name: parseBudgetCSV() keys the
  // starting-balance row off it. It accepts the legacy "TD checking" too.
  row("Checking", (c) => c.tdChecking);
  for (const name of layout.otherIncomeNames) row(name, (c) => c.otherInItems?.[name]?.val || 0);
  row("TOTAL IN", (c) => c.totalIn);

  lines.push(csvRow(["FIXED / RECURRING"]));
  for (const name of layout.sectionItems.bill) row(name, (c) => c.expenseItems[name]?.val || 0);

  lines.push(csvRow(["SAVING / DEBT"]));
  for (const name of layout.sectionItems.saving) row(name, (c) => c.expenseItems[name]?.val || 0);

  lines.push(csvRow(["ONE-OFF / SEASONAL"]));
  for (const name of layout.sectionItems.oneoff) row(name, (c) => c.expenseItems[name]?.val || 0);

  row("TOTAL OUT", (c) => c.totalOut);
  row("MONTHLY NET", (c) => c.net);
  row("CUMULATIVE NET", (c) => c.cumulative);

  return lines.join("\r\n");
}
