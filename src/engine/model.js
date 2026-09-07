// ---- Data model: the single source of truth ----
// Everything (ledger rows, budget totals, balances) is COMPUTED from this.

// Categories are preset for v1.
export const CATEGORIES = {
    income:    { label: "Income",            color: "#0B7A0B", direction: "in"  },
    bill:      { label: "Fixed Bill",        color: "#7030A0", direction: "out" },
    oneoff:    { label: "One-off",           color: "#C0392B", direction: "out" },
    roth:      { label: "Roth",              color: "#6A1B9A", direction: "out" },
    saved:     { label: "Saved",             color: "#0B7A0B", direction: "out" },
    brokerage: { label: "Brokerage",         color: "#1565C0", direction: "out" },
    loans:     { label: "Loans",             color: "#B36A00", direction: "out" },
  };

  // The four categories that feed the cumulative tracker columns on the ledger.
  // The category IS the tracker now — there is no separate `tracker` field.
  export const TRACKER_CATEGORIES = ["roth", "saved", "brokerage", "loans"];
  
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
        showCumulative: false,
        hasSeenOnboarding: false, // one-time welcome wizard; see storage.js's migration
      },
      recurring: [], // rules that auto-generate events
      oneoffs: [],   // individual dated events
      paidOverrides: {}, // { "YYYY-MM": [ruleId,...] } — bills marked paid (feature 9)
    };
  }
  
  // A recurring rule shape (for reference):
  // { id, name, amount, category, cadence, dayOfMonth, startDate, endDate|null, order }

  // A one-off shape:
  // { id, name, amount, category, date, order }
  
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