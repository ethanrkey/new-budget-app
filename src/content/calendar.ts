// The month grid's words, and the ONE copy of them.
//
// Same rule as src/content/tour.ts and src/content/setup.ts: the web
// draws a seven-column grid with a detail panel under it and the phone
// draws a seven-column grid with a detail panel under it. The words
// are the same words, and the only thing that differs between the two
// is how wide the number is allowed to be — see cellAmountCompact and
// cellAmountFull in src/engine/calendar.ts.
export const CALENDAR_COPY = {
  /** Leads the detail panel. The question the grid exists to answer.
   *  The cell above it is rounded to whole dollars for room; this one
   *  is the exact figure, because it is the day you asked about. */
  balanceAfter: "Balance after:",
  /** Before anything has been picked. */
  hint: "Pick a day to see where your balance lands and what moved it.",
  /**
   * A past day the user recorded a balance on. REAL, and said so:
   * the cell wears a "logged" tag and the panel uses this instead of
   * "Balance after:", because one is a fact and the other is a
   * projection and a calendar that showed them identically would be
   * inviting the reader to confuse them.
   */
  loggedBalance: "Logged balance:",
  /** The cell's own tag, which has room for one word. */
  loggedTag: "logged",
  /** A day the forecast does not cover, because it is behind the anchor. */
  beforeAnchor: (asOf: string) =>
    `No forecast before ${asOf} — your checking balance already accounts for what happened then. Days you logged a balance on show what you recorded.`,
  /** A day past the end of the Ledger's window. */
  pastHorizon: "Past the end of your Ledger window. Move the horizon out to project this far.",
  /** A covered day with nothing on it. The balance line is still shown. */
  quiet: "Nothing due or expected this day.",
} as const;
