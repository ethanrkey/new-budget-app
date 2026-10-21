// Connected checking, decided rather than drawn. Everything here is a
// pure function of a connection and a clock, so both clients ask the
// same questions and get the same answers, and a test can ask them
// without a renderer.
//
// NOTHING IN THIS FILE TOUCHES PLAID, loads a script, or imports an
// SDK. It is reachable from a cold start with connected features off,
// and that is deliberate — the gate has to be answerable before any
// of the machinery behind it exists.
import { PILL, PILL_SUFFIX, PILL_SUFFIX_LONG } from "../content/connect.ts";

/** What the server says about a user's connection. Mirrors `plaid_items`. */
export interface Connection {
  institutionName: string | null;
  /** 'ok' | 'login_required' | 'error' */
  status: string;
  /** ISO instant, or null if it has never successfully pulled. */
  lastSyncedAt: string | null;
  /** The last four digits, for Settings. Never the account number. */
  mask?: string | null;
}

/**
 * The five pill states, named for what they MEAN. The owner dictated
 * the five strings; this is the question of which one you are in.
 */
export type PillState = "manual" | "synced" | "loggedToday" | "stale" | "reconnect";

/**
 * How long after a successful sync the pill stops saying "synced
 * <time>" and starts saying "synced <date and time>".
 *
 * NOT THE SAME NUMBER AS THE STALENESS WINDOW, and they must not be
 * made the same. The server pulls when the last one is 12 hours old;
 * this is about whether a bare clock time is still unambiguous to
 * read. "synced 8:14 AM" on a reading from two days ago is a lie told
 * by a format.
 */
export const SAME_DAY_ONLY = true;

/**
 * Which state the Checking pill is in.
 *
 * ORDER MATTERS, and it is worst-news-first. A connection that needs
 * reconnecting says so even if today's number was typed by hand,
 * because the reconnect prompt is the only thing on the pill that
 * asks for an action. Everything below it is a description.
 *
 * `snapshotSource` is the source of the balance CURRENTLY ON SCREEN —
 * the newest snapshot — not of the last pull. That is the whole point
 * of "logged today": when the manual log won, the number beside the
 * word came from the user, and saying "synced" would be attributing
 * their own figure to their bank.
 */
export function pillStateOf(
  connection: Connection | null,
  snapshotSource: "manual" | "plaid" | undefined,
  snapshotDate: string,
  today: string,
): PillState {
  if (!connection) return "manual";
  if (connection.status === "login_required") return "reconnect";
  if (!connection.lastSyncedAt) return "manual";
  // The user typed today's number, and it beat the pull. See
  // plaid_write_balance: manual wins on a shared date.
  if (snapshotDate === today && (snapshotSource ?? "manual") === "manual") return "loggedToday";
  if (connection.status !== "ok") return "stale";
  return "synced";
}

/**
 * The pill's words, from the state and the pieces.
 *
 * ONE PLACE, because the five strings are the owner's and the only
 * way to keep them his is to stop two clients from each assembling
 * their own version.
 */
export function pillTextOf(
  state: PillState,
  parts: { amount: string; asOf: string; syncedTime: string; syncedWhen: string },
): string {
  switch (state) {
    case "reconnect": return PILL.reconnect(parts.amount);
    case "loggedToday": return PILL.loggedToday(parts.amount);
    case "stale": return PILL.stale(parts.amount, parts.syncedWhen);
    case "synced": return PILL.synced(parts.amount, parts.syncedTime);
    case "manual": return PILL.manual(parts.amount, parts.asOf);
  }
}

/**
 * The same five, as just the half after the dot — what the phone
 * draws under the balance, because its anchor strip gives the date
 * its own line by measurement. Same words, one source.
 */
export function pillSuffixOf(
  state: PillState,
  parts: { asOf: string; syncedTime: string; syncedWhen: string },
): string {
  switch (state) {
    case "reconnect": return PILL_SUFFIX.reconnect();
    case "loggedToday": return PILL_SUFFIX.loggedToday();
    case "stale": return PILL_SUFFIX.stale(parts.syncedWhen);
    case "synced": return PILL_SUFFIX.synced(parts.syncedTime);
    case "manual": return PILL_SUFFIX.manual(parts.asOf);
  }
}

/**
 * The web's form: one line, full stamp. Same state, same words for
 * the verb, more of the timestamp.
 */
export function pillLongOf(
  state: PillState,
  parts: { amount: string; asOf: string; syncedStamp: string; loggedStamp: string },
): string {
  switch (state) {
    case "reconnect": return `${parts.amount} · ${PILL_SUFFIX_LONG.reconnect()}`;
    case "loggedToday": return `${parts.amount} · ${PILL_SUFFIX_LONG.loggedToday(parts.loggedStamp)}`;
    case "stale": return `${parts.amount} · ${PILL_SUFFIX_LONG.stale(parts.syncedStamp)}`;
    case "synced": return `${parts.amount} · ${PILL_SUFFIX_LONG.synced(parts.syncedStamp)}`;
    case "manual": return `${parts.amount} · ${PILL_SUFFIX_LONG.manual(parts.asOf)}`;
  }
}

/**
 * Is there a manual override to drop?
 *
 * "Use bank balance" is only offered when it would DO something.
 * Offering it beside a number the bank already gave you is a button
 * that claims to change something and does not.
 */
export const canUseBankBalance = (state: PillState): boolean => state === "loggedToday";

/** Only the reconnect state asks for something, so only it is gold. */
export const pillIsAction = (state: PillState): boolean => state === "reconnect";

/**
 * Should the app ask the server for a balance on open?
 *
 * THE REAL DECISION IS THE SERVER'S — it owns the 12-hour clock,
 * per account, so one pull serves every device. This is only about
 * whether to make the call at all, and it answers no in the two cases
 * where the call could not possibly do anything: the feature is off,
 * or there is nothing connected.
 *
 * It deliberately does NOT try to second-guess the staleness window
 * from a client clock. This codebase already refuses to trust device
 * clocks (see syncGuard.ts), and a client that skipped the call
 * because its own clock said "too soon" would be the one way a user
 * could end up with a balance nobody ever refreshed.
 */
export function shouldPullOnOpen(
  settings: { connectedFeatures: boolean },
  connection: Connection | null,
): boolean {
  return settings.connectedFeatures && !!connection;
}

/**
 * Is there any Connect entry point to draw?
 *
 * BOTH HALVES ARE REQUIRED and they are not the same question. The
 * allowlist is a term of Plaid's plan — live connections are limited
 * to people the owner knows — and the toggle is the user's own
 * choice. Someone not allowlisted does not see the toggle; someone
 * allowlisted who left it off does not see Connect.
 */
export function canOfferConnect(
  settings: { connectedFeatures: boolean },
  allowlisted: boolean,
): boolean {
  return allowlisted && settings.connectedFeatures;
}

/** The toggle itself is drawn for allowlisted accounts and nobody else. */
export const canSeeToggle = (allowlisted: boolean): boolean => allowlisted;

/**
 * Should the Log balance sheet show "Want this automatic?"
 *
 * NOT IN SETUP, and not to someone who already has it on, and not to
 * someone who said don't show again. It is offered to a person who
 * has just typed a balance by hand and therefore knows what that
 * costs them — which is the only moment the sentence is useful rather
 * than promotional.
 */
export function shouldOfferHint(
  settings: { connectedFeatures: boolean; hideConnectHint: boolean },
  allowlisted: boolean,
): boolean {
  return allowlisted && !settings.connectedFeatures && !settings.hideConnectHint;
}

/**
 * What a user is told when a refresh does nothing.
 *
 * EVERY ONE OF THESE IS A NON-EVENT, and none of them is an error.
 * The button did nothing because nothing needed doing, or because
 * they have asked four times today. Saying "failed" would be wrong
 * and saying nothing would read as a dead button.
 */
export function refreshOutcome(reason: string | undefined): string | null {
  switch (reason) {
    case "just_now": return "Refreshed just now";
    case "fresh": return "Already up to date";
    case "daily_cap": return "You've refreshed a few times today — try again tomorrow";
    case "no_balance":
    case "no_account":
    case "no_local_account": return "Your bank didn't return a balance";
    default: return null;
  }
}
