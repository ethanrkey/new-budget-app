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
export type PillState = "manual" | "synced" | "syncing" | "loggedToday" | "stale" | "reconnect";

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
  /**
   * A pull is in flight right now.
   *
   * ABOVE EVERYTHING INCLUDING RECONNECT, and it is the one state
   * that outranks worst-news-first. The others describe a number
   * that is on screen; this one says the answer is being fetched,
   * and a reconnect prompt shown over a pull that may be about to
   * succeed asks for work nobody may need to do. It lasts seconds.
   *
   * Default false, so every caller that has no idea whether a pull
   * is running keeps the behavior it had.
   */
  syncing = false,
  /**
   * The connection has not been read yet, on an account that has
   * connected features on (2026-10-30).
   *
   * A cold start drew "as of 10/27" — the MANUAL label — for the
   * second before the row arrived and the pill turned into "synced
   * 7:50 AM". For an account with a bank that is the app saying,
   * briefly and wrongly, that there is no bank. While it is still
   * finding out it says so. Once the read is done this is false
   * again, and an account that turns out to have nothing connected
   * reads "as of" like any other.
   */
  connecting = false,
): PillState {
  if (syncing && connection) return "syncing";
  if (connecting && !connection) return "syncing";
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
  parts: { amount: string; asOf: string; syncedTime: string; syncedWhen: string; loggedStamp: string },
): string {
  switch (state) {
    case "reconnect": return PILL.reconnect(parts.amount);
    case "syncing": return PILL.syncing(parts.amount);
    case "loggedToday": return PILL.loggedToday(parts.amount, parts.loggedStamp);
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
  parts: { asOf: string; syncedTime: string; syncedWhen: string; loggedStamp: string },
): string {
  switch (state) {
    case "reconnect": return PILL_SUFFIX.reconnect();
    case "syncing": return PILL_SUFFIX.syncing();
    case "loggedToday": return PILL_SUFFIX.loggedToday(parts.loggedStamp);
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
    case "syncing": return `${parts.amount} · ${PILL_SUFFIX_LONG.syncing()}`;
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
 * Is a repair on offer, and does it have to be update mode?
 *
 * ALWAYS UPDATE MODE. There is no "reconnect from scratch" path and
 * there must not be one: Plaid's Trial is ten Items EVER,
 * `/item/remove` does not give one back, and two Items for the same
 * account count twice — so disconnect-then-connect to fix a login
 * silently spends a second slot out of ten. This predicate exists so
 * that both clients ask the same question and neither invents a
 * second answer.
 */
export const canReconnect = (connection: Connection | null): boolean =>
  !!connection && connection.status === "login_required";

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
 * Does the toggle need putting back?
 *
 * A LIVE BANK WITH THE FEATURE OFF IS NOT A STATE THIS APP HAS, so
 * wherever the two disagree the connection is the one telling the
 * truth: it exists at Plaid, it has an access token, and it is being
 * pulled. The switch is a record of a decision and can be stale; the
 * Item cannot.
 *
 * FOUND ON IOS, 2026-10-21. Hosted Link hands the user to a browser
 * and the app re-reads everything when they come back — including
 * the account's settings, from the server. The phone returned with a
 * connected bank and a switch that said off, and because the switch
 * said off nothing would read the connection again to notice. That
 * is the shape to avoid: a disagreement that hides the evidence of
 * itself.
 *
 * It is deliberately NOT "turn the feature on because a row exists".
 * It is only consulted at a moment when the caller has just read a
 * live connection with the feature believed on — see openLink.
 */
export function shouldRestoreToggle(
  settings: { connectedFeatures: boolean },
  connection: Connection | null,
): boolean {
  return !!connection && !settings.connectedFeatures;
}

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

/**
 * WHEN TO STOP ASKING (2026-10-30).
 *
 * Every focus and every foreground used to ask plaid-balance whether
 * a pull was due, and the pill said "syncing…" for each — five tab
 * switches, five flashes, over a balance that was fresh the whole
 * time. The server now answers with how long until it would pull
 * (`next_pull_in_seconds`, by ITS clock), and the client skips the
 * question until that has passed.
 *
 * TWO CLOCKS, AND EITHER ONE CAN SAY "ASK". The wall clock can be
 * wrong; the monotonic one (performance.now) does not advance while
 * a laptop sleeps on some platforms, which is exactly the overnight
 * tab the 12-hour window exists for. Skipping needs BOTH to agree it
 * is too soon, so a wrong answer needs both to be wrong at once.
 * And a cold start always asks, because a new process has no
 * deadline at all — so the worst any clock fault can do is delay a
 * pull until the next launch, never prevent one.
 */
export interface PullDeadline { wallAt: number; monoAt: number }

export function deadlineFrom(seconds: number | null | undefined, wallNow: number, monoNow: number): PullDeadline | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const ms = Math.max(0, seconds) * 1000;
  return { wallAt: wallNow + ms, monoAt: monoNow + ms };
}

/** No deadline is "ask": nothing has told us it is too soon. */
export function pullDue(deadline: PullDeadline | null, wallNow: number, monoNow: number): boolean {
  if (!deadline) return true;
  return wallNow >= deadline.wallAt || monoNow >= deadline.monoAt;
}

/**
 * HAS THE BANK MOVED SINCE WE LAST LOOKED?
 *
 * A pull this device made reports whether it wrote. A pull it did
 * NOT see the answer to — another device's, a cron's, or its own
 * whose reply was lost — reports nothing, and the only trace on this
 * device is `last_synced_at` moving. That is how the phone showed
 * "synced 7:50 AM" beside yesterday's $818.50 (2026-10-30): the stamp
 * came from a re-read of the connection, the balance from a state
 * nobody re-read. A stamp that moves means the rows may have, so the
 * state is re-read.
 */
export function syncMoved(before: string | null | undefined, after: string | null | undefined): boolean {
  if (!after) return false;
  if (!before) return true;
  return Date.parse(after) > Date.parse(before);
}
