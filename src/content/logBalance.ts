// The confirmation shown when logging a balance would hide rows, and
// the ONE copy of it.
//
// Both clients ask the same question for the same reason, so they ask
// it in the same words — same rule as about.ts, tour.ts, setup.ts and
// dashboard.ts.
//
// WHAT THE WARNING IS ACTUALLY FOR. Moving the verified balance
// forward drops every ledger row before it, because the balance
// already contains them. That is right, and it is silent — the list
// just gets shorter. The case that costs money is the honest mistake:
// a bill dated the 3rd that has NOT gone out yet. Hiding it does not
// pay it, and the forecast stays too high by that amount for ever.
//
// So the copy does three things in order: names what disappears, says
// why that is usually correct, and gives the out for when it is not.

export const HIDDEN_ROWS_COPY = {
  title: "This will hide rows already in your ledger",
  /** "3 rows dated before Oct 14 will drop off:" */
  lede: (count: number, asOf: string) =>
    `${count} ${count === 1 ? "row" : "rows"} dated before ${asOf} will drop off the Ledger:`,
  why: "That is usually right: a balance you just read from your bank already includes anything that has gone out, so keeping these would count them twice.",
  escape: "If one of them has NOT actually left your account yet, cancel and move it to a later date first — hiding it does not pay it, and your forecast will stay too high.",
  confirm: "Log balance",
  cancel: "Cancel",
} as const;
