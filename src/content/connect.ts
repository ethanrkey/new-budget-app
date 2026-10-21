// Connected checking: every word of it, in one place, because this is
// the copy where being wrong is not a typo.
//
// THE RULE FOR THIS FILE: every sentence here must be checkable
// against code. "We never receive your transactions" is true because
// the Transactions product is never requested and no endpoint that
// returns one is reachable — see supabase/functions/_shared/plaid.ts,
// where the endpoint list is closed. If a sentence here cannot be
// traced to something in that file or in supabase/plaid.sql, it does
// not belong here.
//
// AND THE OTHER RULE, which decides tone throughout: MANUAL ENTRY IS
// THE PRODUCT. Connecting a bank is an optional extra. Nothing below
// may imply that connecting is expected, recommended, better, or what
// a serious user does. It is a convenience with a cost, described
// plainly, and "Not now" is a complete answer.

/**
 * WHAT PLAID'S OWN SCREEN WILL SAY, and why our screen has to agree
 * with it.
 *
 * Plaid does not accept `balance` in the Link products array and the
 * array cannot be empty, so exactly one product is named purely to
 * get Balance initialized. Plaid's Data Transparency Messaging then
 * lists that product's data scopes on its own consent screen —
 * BEFORE the user ever sees a bank login — and those scopes describe
 * what Plaid may reach, not what we intend to read.
 *
 * With `products: ["identity"]`, Plaid's screen shows:
 *
 *   Account and balance info — "account name, type, description,
 *     balances, and masked account number"
 *   Contact info — "account owner name, email, phone, and address"
 *
 * With `products: ["auth"]` it adds a third:
 *
 *   Account and routing number — "account number and financial
 *     institution routing numbers"
 *
 * THE COPY BELOW IS WRITTEN FOR `identity`, which is what
 * _shared/plaid.ts asks for. If that constant changes, the bullet
 * marked PLAID-SCOPES changes in the same commit. A consent screen
 * that is out of date is worse than no consent screen: it is a
 * promise the software is not keeping.
 */
export const PLAID_SCOPE_NOTE = "Plaid will have access to your account and balance info and your contact info.";

export interface ConsentScreen {
  title: string;
  bullets: string[];
  footer: string;
  footerLinkText: string;
  footerLinkUrl: string;
  confirm: string;
  cancel: string;
}

export const CONNECT_CONSENT: ConsentScreen = {
  title: "Connect your bank (balance only)",
  bullets: [
    // What WE do. First, because it is the only part of this we
    // control and the only part we can be held to.
    "Key Budget only reads your checking balance. Nothing else — we never receive, see, or store your transactions.",
    // PLAID-SCOPES. What PLAID gets, which is more than we use, and
    // saying so is the entire point of this screen. The old draft
    // said "Plaid only asks for your balance", which was not true:
    // Plaid's own screen names more than that, and a user who read
    // ours first would have thought Plaid's was the lie.
    "Your bank connection is handled by Plaid. Plaid will have access to your account and balance info and your contact info — more than Key Budget uses. Plaid's own screen will tell you this too.",
    "Your bank login goes to Plaid and your bank. Key Budget never sees it.",
    "Disconnect anytime in Settings. That removes Key Budget's access right away. Balances already pulled stay in your history, the same as ones you typed.",
    // Their rights against PLAID, which we cannot exercise for them
    // and must therefore name. Without this the screen quietly
    // implies that disconnecting here is the end of it.
    "To see or delete what Plaid holds, use Plaid Portal at my.plaid.com.",
  ],
  footer: "Connections are handled by Plaid.",
  footerLinkText: "Plaid's privacy policy",
  footerLinkUrl: "https://plaid.com/legal/#end-user-privacy-policy",
  confirm: "Continue",
  cancel: "Not now",
};

/**
 * The same Plaid Portal note, beside Disconnect in Settings.
 *
 * Repeated rather than cross-referenced because the two are read
 * months apart: the consent screen is read once, at the beginning,
 * and this is read by someone who has decided to leave.
 */
export const DISCONNECT_NOTE =
  "Disconnecting removes Key Budget's access right away. Balances already pulled stay in your history. To see or delete what Plaid holds, use Plaid Portal at my.plaid.com.";

export const PLAID_PORTAL_URL = "https://my.plaid.com";

/**
 * The line on the Log balance sheet while connected features are off.
 *
 * NOT IN SETUP, on the owner's call, and the reason generalizes: a
 * person deciding whether to use this app at all is the wrong person
 * to offer a bank connection to. This appears to someone who has
 * logged a balance by hand and therefore knows what the manual path
 * costs them.
 *
 * It loads no Plaid code. It is a sentence and a link to Settings.
 */
export const CONNECT_HINT = "Want this automatic? Turn on connected features in Settings.";
export const CONNECT_HINT_DISMISS = "Don't show again";

/**
 * The Checking pill, exactly as dictated 2026-10-20.
 *
 * TEXT ONLY, NO ICON. Five states, and the thing they have in common
 * is that the balance is in the same place and reads the same way in
 * all of them — the connection is a detail about where the number
 * came from, never a different kind of number.
 */
/**
 * THE HALF AFTER THE DOT, which is the half that varies.
 *
 * It is split out because the two clients lay the pill out
 * differently and must not therefore word it differently. The web
 * puts the whole thing on one line. The phone cannot: the anchor
 * strip was measured at 260pt and the date was given its own line
 * precisely because one line truncates at the narrowest width (see
 * mobile/components/AnchorStrip.tsx, which has the arithmetic). So
 * the phone draws the balance and then THIS, and the sentence is
 * still the owner's.
 */
export const PILL_SUFFIX = {
  /** Not connected, which is the ordinary case and reads as one. */
  manual: (date: string) => `as of ${date}`,
  /** Connected and recently synced. */
  synced: (time: string) => `synced ${time}`,
  /** Connected, but today's number is one the user typed. Manual wins. */
  loggedToday: () => "logged today",
  /** Connected, pulls are failing, so the last GOOD time is shown. */
  stale: (when: string) => `synced ${when}`,
  /**
   * The bank wants the user back. Gold, because it is the one state
   * that asks for something — and it names the action rather than
   * the problem, since "disconnected" tells you nothing to do.
   */
  reconnect: () => "Reconnect",
} as const;

/**
 * THE LONG FORM, which is the web's.
 *
 * The owner's call, 2026-10-20, after seeing both: a browser has the
 * room for a full stamp and a phone does not, and "synced 8:14 AM"
 * on a page you left open since yesterday is ambiguous in a way it
 * never is on a phone you just picked up. So the web says
 * "synced 10/20/2026, 8:46 PM" and the phone keeps the short form.
 *
 * SAME FIVE STATES, SAME DECISION — only the rendering differs, and
 * both come from `pillStateOf`. The Dashboard card is untouched and
 * still reads "as of": it is a different sentence about a different
 * thing.
 */
export const PILL_SUFFIX_LONG = {
  manual: (date: string) => `as of ${date}`,
  synced: (stamp: string) => `synced ${stamp}`,
  /** A manual override, with the moment it was typed. */
  loggedToday: (stamp: string) => `logged ${stamp}`,
  stale: (stamp: string) => `synced ${stamp}`,
  reconnect: () => "Reconnect",
} as const;

export const PILL = {
  manual: (amount: string, date: string) => `${amount} · ${PILL_SUFFIX.manual(date)}`,
  synced: (amount: string, time: string) => `${amount} · ${PILL_SUFFIX.synced(time)}`,
  loggedToday: (amount: string) => `${amount} · ${PILL_SUFFIX.loggedToday()}`,
  stale: (amount: string, when: string) => `${amount} · ${PILL_SUFFIX.stale(when)}`,
  reconnect: (amount: string) => `${amount} · ${PILL_SUFFIX.reconnect()}`,
} as const;

/** The sheet behind the pill when connected. */
export const PILL_SHEET = {
  refresh: "Refresh now",
  manual: "Log manually",
  /**
   * Drop today's typed figure and take the bank's.
   *
   * THE COUNTERPART TO "MANUAL WINS", and the reason that rule can
   * be strict. Without this, changing your mind about a number you
   * typed means waiting for tomorrow's pull — so the safe default
   * becomes the frustrating one. It makes NO Plaid call: the number
   * is already stored from the last pull, and charging a billed
   * request to undo your own typing would be absurd.
   *
   * Only offered when there IS a manual override to drop.
   */
  useBank: "Use bank balance",
  /** e.g. "Last synced 8:14 AM". */
  lastSynced: (when: string) => `Last synced ${when}`,
} as const;
