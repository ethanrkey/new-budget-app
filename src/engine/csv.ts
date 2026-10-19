// ---- CSV export: pure string builders, no DOM/File APIs here ----
// (those live in the component that triggers the actual download)
import { categoryLabelOf } from "./model.ts";
import { computeBudgetLayout, BUDGET_SECTIONS } from "./budgetLayout.ts";
import type { BudgetColumn, Ledger, TrackerCategory } from "./types.ts";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}
function fmt(n: number | null | undefined): string {
  return n || n === 0 ? Number(n).toFixed(2) : "";
}

// Every ledger row, one per line: date, item, category, in/out, running
// balance, and one cumulative-tracker column per user-defined category
// (blank except on the row that steps it) — matches what's shown on screen
// with the columns open. `trackerCategories` is the user's own list (order
// = column order); pass it explicitly so an export always matches whoever's
// data it came from, not some hardcoded set.
export function ledgerToCSV(ledger: Ledger, trackerCategories: TrackerCategory[] = []): string {
  // `.order` is the source of truth for column sequence, not array
  // position — see budgetLayout.ts's identical note.
  const cats = [...trackerCategories].sort((a, b) => a.order - b.order);
  const lines = [csvRow(["Date", "Item", "Category", "In", "Out", "Balance", ...cats.map((c) => c.name)])];
  for (const r of ledger.rows) {
    lines.push(csvRow([
      r.date,
      r.name,
      // A bill the user flagged as varying exports as "Variable bill",
      // not "Fixed bill" — the Category column is the one place a
      // spreadsheet can see what kind of number the amount is.
      categoryLabelOf(r.category, { variable: r.variable }, cats),
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
export function budgetToCSV(budget: BudgetColumn[], trackerCategories: TrackerCategory[] = []): string {
  if (budget.length === 0) return "";
  const layout = computeBudgetLayout(budget, trackerCategories);
  const lines = [csvRow(["", ...budget.map((c) => c.label)])];
  const row = (label: string, pick: (c: BudgetColumn) => number) => lines.push(csvRow([label, ...budget.map((c) => fmt(pick(c)))]));

  lines.push(csvRow(["INCOME"]));
  row("Starting point", (c) => c.startingPoint);
  row("Take-home", (c) => c.takeHome);
  // A FIXED label, not the account's name: parseBudgetCSV() keys the
  // starting-balance row off it. It accepts the legacy "TD checking" too.
  row("Checking", (c) => c.tdChecking);
  // Keyed by id, labeled by name: two rows legitimately share a label
  // (see budgetLayout.ts), and the lookup must not.
  for (const r of layout.otherIncome) row(r.name, (c) => c.otherInItems?.[r.key]?.val || 0);
  row("TOTAL IN", (c) => c.totalIn);

  // Straight through BUDGET_SECTIONS, which IS the display order. This
  // used to be three hard-coded blocks in a fourth sequence, under a
  // comment promising to match the screen.
  for (const section of BUDGET_SECTIONS) {
    lines.push(csvRow([section.label]));
    for (const r of layout.sectionItems[section.key]) row(r.name, (c) => c.expenseItems[r.key]?.val || 0);
  }

  row("TOTAL OUT", (c) => c.totalOut);
  row("MONTHLY NET", (c) => c.net);
  row("CUMULATIVE NET", (c) => c.cumulative);

  return lines.join("\r\n");
}
