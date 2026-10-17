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

/**
 * The sheet that logs a reading on a tracked account.
 *
 * NAMES THE ACCOUNT, from 2026-10-17. The phone's title was "Log a
 * balance" — three words that say what the sheet does and not what it
 * is about, over a form that could belong to any of five cards. The
 * web fell through to "Update <name> balance", which names the
 * account but uses the checking bar's verb for a different thing: the
 * checking balance is the anchor the whole forecast counts forward
 * from and you UPDATE it, while a savings reading is one more point
 * on a history and you LOG it.
 *
 * "current" is doing work too — it is the number the bank is showing
 * you right now, which is the question the date field underneath is
 * about.
 */
/**
 * Leaving a balance sheet with something typed in it.
 *
 * Its own words rather than the transaction form's DISCARD, which
 * says "this transaction hasn't been saved" — true there, and wrong
 * about a sheet that logs a number against an account.
 */
export const DISCARD_BALANCE = {
  title: "Discard this balance?",
  body: "You haven't logged it yet. Leaving now throws away the amount you typed.",
  keep: "Keep editing",
  discard: "Discard",
} as const;

/** Leaving an account's own form with something changed in it. */
export const DISCARD_ACCOUNT = {
  title: "Discard these changes?",
  body: "This account hasn't been saved. Leaving now throws away what you changed.",
  keep: "Keep editing",
  discard: "Discard",
} as const;

/** Leaving the "put money in regularly?" offer with an amount typed. */
export const DISCARD_CONTRIBUTION = {
  title: "Discard this contribution?",
  body: "It hasn't been scheduled yet. Leaving now throws away what you typed.",
  keep: "Keep editing",
  discard: "Discard",
} as const;

export const LOG_BALANCE_TITLE = (account: string) =>
  `Log the current balance of ${account}`;

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
