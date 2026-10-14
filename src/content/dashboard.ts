// The Dashboard's section cards, and the ONE copy of their words.
//
// Same rule as about.ts, tour.ts and setup.ts. These four strings
// explain what a savings account is for and what a loan is for, and
// they are the first thing a new user reads on the screen that is
// otherwise all numbers — so they are worth keeping identical on both
// clients rather than approximately the same.
//
// Moved here 2026-10-14, when the phone's Dashboard was brought up to
// the web's structure: a dashed add-card at the end of the savings
// section, and a debt section that is one summary card collapsed and
// an add-card plus the loans expanded.

export const DASHBOARD_COPY = {
  addAsset: {
    label: "Savings & investments",
    body: "A savings account, a Roth IRA, a brokerage — anything you want a balance, a history, and a contribution trend for.",
    cta: "+ Add account",
  },
  addLoan: {
    label: "Loans",
    body: "Car loan, mortgage, student loan — a loan is its own category; payments tag to it like Roth contributions tag to Roth.",
    cta: "+ Add loan",
    collapse: "Minimize",
  },
  debt: {
    label: "Debt",
    /** "3 loans", and "1 loan" — the plural is a decision, not a suffix. */
    count: (n: number) => `${n} loan${n === 1 ? "" : "s"}`,
    /** The tail on the count line when some loans have no reading yet. */
    unlogged: (n: number) => `${n} not logged yet`,
    /** A loan with no reading. It is not zero; it is unknown. */
    notLogged: "not logged",
    expand: (n: number) => `Show ${n} loan${n === 1 ? "" : "s"}`,
  },
} as const;
