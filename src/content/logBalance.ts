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

/**
 * What the date field on these sheets is called.
 *
 * TWO DIFFERENT QUESTIONS THROUGH ONE FORM. Logging a balance asks
 * "as of" — the reading is a statement about an account at a moment,
 * and the date says which moment it describes. A contribution is not
 * a statement about a moment: it is a thing that happened, and the
 * date is simply when. "As of" over it reads as though the money
 * might have been put in earlier and only counted from then.
 *
 * Same form, because amount + date + a button twice over is two
 * places to fix everything — so the word is a prop with a default,
 * and it lives here where both clients read it.
 */
/**
 * WHY SAVE WOULD NOT WORK, said out loud.
 *
 * THE RULE THESE THREE NOW FOLLOW, which the transaction sheet and
 * the category sheet already did: the button always responds and
 * says what is wrong. A dead button with no explanation is the
 * thing people tap twice and then give up on — and "Save" grayed
 * out because of a stray letter in a number field is indentical, to
 * the person looking at it, to an app that is broken.
 *
 * The button is still disabled WHILE SAVING. That is not a
 * validation state; it is one write in flight, and tapping it twice
 * would be two.
 *
 * Each returns null when there is nothing wrong, which is also
 * "may this be submitted".
 *
 * EVERY ONE COERCES ITS INPUT, because these run on RENDER. A saved
 * one-off's amount is a NUMBER, the web's event form seeded its field
 * straight from it, and `.trim()` on a number threw — which, during
 * render and with no error boundary, blanked the entire app the moment
 * anyone clicked an existing one-off (2026-10-26 to 10-28, production).
 * A validator is the last thing that should be able to crash a form.
 */
const text = (typed: unknown): string => String(typed ?? "");

export const WHY_NOT = {
  /** A balance: any number at all, including a negative one. */
  balance: (raw: unknown): string | null => {
    const typed = text(raw);
    if (typed.trim() === "") return "Enter the balance.";
    return Number.isNaN(Number(typed)) ? "That is not a number." : null;
  },
  /**
   * A contribution: a number ABOVE zero. Zero is refused on purpose
   * and says so — a contribution of nothing is not a contribution,
   * and the old form silently declined it.
   */
  contribution: (raw: unknown): string | null => {
    const typed = text(raw);
    if (typed.trim() === "") return "Enter an amount.";
    const n = Number(typed);
    if (Number.isNaN(n)) return "That is not a number.";
    return n > 0 ? null : "Enter an amount more than zero.";
  },
  /** One occurrence's own amount, on the web's event form. */
  occurrence: (raw: unknown): string | null => {
    const typed = text(raw);
    if (typed.trim() === "") return "Enter an amount for this date.";
    return Number.isNaN(Number(typed)) ? "That is not a number." : null;
  },
  /**
   * A rule or a one-off: it needs a name AND an amount, and the
   * message names whichever is missing rather than both.
   */
  event: (name: unknown, raw: unknown): string | null => {
    const typed = text(raw);
    if (!text(name).trim()) return "Give it a name.";
    if (typed.trim() === "") return "Enter an amount.";
    return Number.isNaN(Number(typed)) ? "That is not a number." : null;
  },
} as const;

export const DATE_LABEL = {
  balance: "As of",
  contribution: "On",
} as const;

export const HIDDEN_ROWS_COPY = {
  title: "This will hide rows already in your ledger",
  /**
   * "3 rows dated before 10/14/2026 will drop off:"
   *
   * `asOf` IS ALREADY FORMATTED. Both clients were handing in the
   * raw ISO string, so the one sentence in this flow that names a
   * date said "dated before 2026-10-21" while every other date on
   * the same screen said 10/21/2026. A date is formatted once, at
   * the edge, by fmtDate — not by whichever caller remembers.
   */
  lede: (count: number, asOf: string) =>
    `${count} ${count === 1 ? "row" : "rows"} dated before ${asOf} will drop off the Ledger:`,
  why: "That is usually right: a balance you just read from your bank already includes anything that has gone out, so keeping these would count them twice.",
  escape: "If one of them has NOT actually left your account yet, cancel and move it to a later date first — hiding it does not pay it, and your forecast will stay too high.",
  confirm: "Log balance",
  cancel: "Cancel",
} as const;
