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

// Every ledger row, one per line: date, item, category, in/out, running
// balance, and the four cumulative tracker columns (blank except on the row
// that steps them) — matches what's shown on screen with the columns open.
export function ledgerToCSV(ledger) {
  const lines = [csvRow(["Date", "Item", "Category", "In", "Out", "Balance", "Roth", "Saved", "Brokerage", "Loans"])];
  for (const r of ledger.rows) {
    lines.push(csvRow([
      r.date,
      r.name,
      CATEGORIES[r.category]?.label ?? r.category,
      r.direction === "in" ? fmt(r.amount) : "",
      r.direction === "out" ? fmt(r.amount) : "",
      fmt(r.balance),
      r.stepped?.key === "roth" ? fmt(r.stepped.value) : "",
      r.stepped?.key === "saved" ? fmt(r.stepped.value) : "",
      r.stepped?.key === "brokerage" ? fmt(r.stepped.value) : "",
      r.stepped?.key === "loans" ? fmt(r.stepped.value) : "",
    ]));
  }
  return lines.join("\r\n");
}

// The monthly grid, exactly as sectioned/ordered on screen (same
// computeBudgetLayout() BudgetView renders from) — one row per line, one
// column per month.
export function budgetToCSV(budget) {
  if (budget.length === 0) return "";
  const layout = computeBudgetLayout(budget);
  const lines = [csvRow(["", ...budget.map((c) => c.label)])];
  const row = (label, pick) => lines.push(csvRow([label, ...budget.map((c) => fmt(pick(c)))]));

  lines.push(csvRow(["INCOME"]));
  row("Starting point", (c) => c.startingPoint);
  row("Take-home", (c) => c.takeHome);
  row("TD checking", (c) => c.tdChecking);
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
