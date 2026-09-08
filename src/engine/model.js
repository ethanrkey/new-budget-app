// ---- Data model: the single source of truth ----
// Everything (ledger rows, budget totals, balances) is COMPUTED from this.

// Fixed categories — not user-customizable. Any OTHER category value is a
// user-defined tracker category (see trackerCategories below): a savings,
// debt, or investment bucket, always direction "out" by definition.
export const CATEGORIES = {
    income: { label: "Income",     color: "#0B7A0B", direction: "in"  },
    bill:   { label: "Fixed Bill", color: "#7030A0", direction: "out" },
    oneoff: { label: "One-off",    color: "#C0392B", direction: "out" },
  };

  // A curated, validated set of 8 colors for user-defined tracker categories
  // (savings/debt/investment) and optional per-item color overrides. Chosen
  // and checked (see scripts/validate_palette.js in the dataviz skill) to be
  // distinct from each other AND from the fixed semantic colors above
  // (income green, bill purple, expense red) — that overlap was the actual
  // bug this palette replaces. Each category stores an INDEX into this array
  // (not a raw hex), so the right light/dark step is always used automatically.
  export const CATEGORY_PALETTE = [
    { name: "Blue",     light: "#2a78d6", dark: "#3987e5" },
    { name: "Orange",   light: "#eb6834", dark: "#d95926" },
    { name: "Teal",     light: "#0d9488", dark: "#199e70" },
    { name: "Gold",     light: "#a16207", dark: "#c98500" },
    { name: "Magenta",  light: "#be185d", dark: "#d55181" },
    { name: "Indigo",   light: "#4f46e5", dark: "#6366f1" },
    { name: "Cyan",     light: "#0891b2", dark: "#0891b2" },
    { name: "Pink",     light: "#db2777", dark: "#ec4899" },
  ];

  // Resolve a palette index (possibly out of range/undefined, e.g. an
  // orphaned category) to a hex for the current theme. Falls back to a
  // neutral gray rather than crashing.
  export function paletteColor(index, isDark) {
    const entry = CATEGORY_PALETTE[index];
    if (!entry) return isDark ? "#9ca3af" : "#6b7280"; // gray-400 / gray-500
    return isDark ? entry.dark : entry.light;
  }

  // A tracker category shape (for reference): { id, name, color, order, kind }
  // `color` is an index into CATEGORY_PALETTE. `id` is what an item's
  // `category` field holds for a savings/debt/investment item. `kind` is
  // "asset" (default — Savings, Investments: balance accumulates from
  // contributions) or "debt" (Loans, credit cards: the Dashboard's
  // "expected" instead comes from amortizing each of its items' own
  // interest rate/original amount, via engine/loans.js — a payment REDUCES
  // what's owed, it doesn't accumulate like a deposit).

  // The 3 starting categories for a brand-new account (no prior data) — see
  // stateShape.js for the migration that instead seeds an EXISTING user's
  // legacy roth/saved/brokerage/loans as their own editable categories.
  export function defaultTrackerCategories() {
    return [
      { id: uid(), name: "Savings",     color: 2, order: 0, kind: "asset" }, // Teal
      { id: uid(), name: "Investments", color: 5, order: 1, kind: "asset" }, // Indigo
      { id: uid(), name: "Debt",        color: 1, order: 2, kind: "debt"  }, // Orange
    ];
  }

  // Cadences a recurring rule can use.
  export const CADENCES = ["weekly", "biweekly", "monthly", "yearly"];

  // A fresh, blank app state.
  export function blankState() {
    return {
      settings: {
        checkInBalance: 0,
        checkInDate: todayISO(),
        budgetHorizon: addMonthsISO(todayISO(), 9),  // default: ~9 months out
        ledgerHorizon: addMonthsISO(todayISO(), 12), // default: ~12 months out
        theme: "light",
        visibleTrackerCategoryIds: [], // which savings/debt columns show on the Ledger; default none
        hasSeenOnboarding: false, // one-time welcome wizard; see storage.js's migration
      },
      recurring: [], // rules that auto-generate events
      oneoffs: [],   // individual dated events
      paidOverrides: {}, // { "YYYY-MM": [ruleId,...] } — bills marked paid (feature 9)
      trackerCategories: defaultTrackerCategories(),
      // Real, actual-world numbers you log yourself — never generated from
      // transactions — used to reconcile the forecast against reality (the
      // Dashboard tab). See engine/progress.js for how these are used.
      balanceSnapshots: {}, // { [trackerCategoryId]: [{ id, date, amount }, ...] } — actual balance check-ins
      monthlyActuals: {},   // { [itemId]: { "YYYY-MM": amount } } — real spend for a variable bill's month
    };
  }

  // A recurring rule shape (for reference):
  // { id, name, amount, category, cadence, dayOfMonth, startDate, endDate|null, order,
  //   color|null, variable|undefined, interestRate|null, originalPrincipal|null }
  // `variable` (bill-category rules only) marks the amount as an estimate
  // rather than a fixed number — enables logging a real monthly total in
  // monthlyActuals from the Dashboard (electric, groceries, gas: the
  // estimate is never exact, unlike rent). Any cadence works — a biweekly
  // variable bill's logged total splits evenly across however many
  // instances land in that month (see generate.js).
  // `interestRate` (APR, as a percent e.g. 5.5) and `originalPrincipal`
  // (the loan's starting balance) apply only to a recurring rule tagged
  // with a DEBT-kind tracker category — together they let engine/loans.js
  // amortize this specific loan's expected remaining balance. Either can be
  // left null/unset; an unconfigured loan is simply skipped in the
  // category's cumulative debt total until both are filled in.

  // A one-off shape:
  // { id, name, amount, category, date, order, color|null }
  // `color` (both shapes) is an optional palette index overriding the
  // default category color for just that one item, e.g. in the Ledger.
  
  // ---- small date helpers (ISO strings "YYYY-MM-DD") ----
  export function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }
  export function addMonthsISO(iso, n) {
    const d = new Date(iso + "T00:00:00");
    d.setMonth(d.getMonth() + n);
    return d.toISOString().slice(0, 10);
  }
  // whole months between two ISO dates, by calendar month (not day-precise)
  export function monthsDiff(aISO, bISO) {
    const a = new Date(aISO.slice(0, 7) + "-01T00:00:00");
    const b = new Date(bISO.slice(0, 7) + "-01T00:00:00");
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  }
  export function uid() {
    return Math.random().toString(36).slice(2, 10);
  }