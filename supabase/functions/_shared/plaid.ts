// Everything the Plaid edge functions share: the config, the one way to
// call Plaid, the one way to log that we did, and the numbers that are
// policy rather than implementation.
//
// THE RULE THIS FILE ENFORCES: balance only. `callPlaid` is the only
// door to Plaid in this codebase, and the endpoints below are the only
// ones it is ever asked for. /auth/get and /identity/get are not here
// and must not be added — see PRODUCTS for why one of them is named in
// the Link token anyway.

/**
 * EVERY PATH HERE WAS VERIFIED AGAINST SANDBOX ON 2026-10-20, and
 * one of them was wrong until that day.
 *
 * `/item/public_token_exchange` (underscore) is not an endpoint;
 * the real one is `/item/public_token/exchange` (slash). Plaid
 * answers the first with `NOT_FOUND`, which reads like "that token
 * does not exist" and is actually "that URL does not exist" — so
 * the first sandbox connection failed AFTER Link had succeeded,
 * with an error message pointing at the wrong half of the system.
 *
 * HOW TO CHECK ONE WITHOUT CREDENTIALS, which is why this is now a
 * fact rather than a memory: Plaid answers an unauthenticated POST
 * with `MISSING_FIELDS` when the endpoint exists and `NOT_FOUND`
 * when it does not. No keys, no account, no risk:
 *
 *   curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
 *     https://sandbox.plaid.com/item/public_token/exchange
 *
 * All seven below answer MISSING_FIELDS. Re-run that loop before
 * adding an endpoint, not after it fails in front of someone.
 */
export const PLAID_ENDPOINTS = {
  linkTokenCreate: "/link/token/create",
  linkTokenGet: "/link/token/get",
  itemPublicTokenExchange: "/item/public_token/exchange",
  accountsBalanceGet: "/accounts/balance/get",
  itemGet: "/item/get",
  institutionsGetById: "/institutions/get_by_id",
  itemRemove: "/item/remove",
  // Verified live 2026-10-21 with an unauthenticated POST, as every
  // path in this object now is: MISSING_FIELDS means it exists,
  // NOT_FOUND means it does not. /item/public_token_exchange was
  // written from memory and spelled with an underscore, and the
  // first sandbox connection died on it.
  webhookVerificationKeyGet: "/webhook_verification_key/get",
} as const;

export type PlaidEndpoint = (typeof PLAID_ENDPOINTS)[keyof typeof PLAID_ENDPOINTS];

/**
 * WHY A PRODUCT IS NAMED HERE AT ALL, when the only thing we read is a
 * balance.
 *
 * Plaid does not accept `balance` in `products` — the Balance product
 * "does not require explicit initialization and will automatically be
 * initialized when any other product is initialized" — and the array
 * must not be empty. So exactly one product is named, it is the
 * cheapest one in terms of what Plaid then shows the user, and NOTHING
 * IN THIS CODEBASE EVER CALLS ITS ENDPOINT.
 *
 * What the user is shown is the thing to optimize, because it is the
 * thing that is true. Plaid's Data Transparency Messaging maps the
 * product to data scopes on its own consent screen:
 *
 *   identity  ->  Account and balance info, Contact info
 *   auth      ->  Account and balance info, Contact info,
 *                 Account and routing number     (Instant Auth / Match)
 *
 * `identity` is a strict subset, and the scope it drops is the one
 * that matters most: an account and routing number is what moves
 * money. We ask for neither, but the user is told what Plaid may
 * reach, not what we intend to read, and the honest way to shorten
 * that list is to ask for less.
 *
 * ONE CONSTANT, because the consent copy has to match it exactly. If
 * this changes, `src/content/connect.ts` changes in the same commit —
 * a consent screen that is out of date is worse than none.
 */
export const PRODUCTS = ["identity"] as const;

/** Checking only. Link shows nothing else, so nothing else can be picked. */
export const ACCOUNT_FILTERS = {
  depository: { account_subtypes: ["checking"] },
} as const;

/**
 * How stale a balance may be before opening the app pulls a new one.
 * Checked PER ITEM, server-side, so one pull serves every device.
 */
export const BALANCE_STALE_AFTER_HOURS = 12;

/**
 * "Refresh now", capped. Two automatic pulls a day plus this is about
 * 180 calls per item per month, which is a number worth knowing before
 * a bill arrives rather than after.
 */
export const MAX_MANUAL_REFRESHES_PER_DAY = 4;

/** And no faster than this, so a double-tap is one call. */
export const REFRESH_DEBOUNCE_SECONDS = 60;

export interface PlaidConfig {
  clientId: string;
  secret: string;
  /** "sandbox" | "production". There is no development environment any more. */
  env: string;
  baseUrl: string;
}

/** The only two environments, and the only two this file will build. */
export const PLAID_ENVS = ["sandbox", "production"] as const;
export type PlaidEnv = (typeof PLAID_ENVS)[number];
export const isPlaidEnv = (v: unknown): v is PlaidEnv =>
  typeof v === "string" && (PLAID_ENVS as readonly string[]).includes(v);

/**
 * The environment a NEW connection is made in, when nothing has said
 * otherwise. Per-user defaults live on `plaid_beta.env`; this is the
 * fallback for a row that has none.
 */
export const defaultEnv = (): string => Deno.env.get("PLAID_ENV") ?? "";

/**
 * Read the secrets for ONE environment, naming any that are missing.
 *
 * PER ITEM, NOT PER PROJECT, since 2026-10-21. `PLAID_ENV` used to
 * be the whole answer, which made sandbox testing and a live
 * connection mutually exclusive on one Supabase project: flipping
 * the secret pointed a real access token at the wrong host and every
 * pull failed. An access token belongs to the environment it was
 * minted in, so the environment belongs on the Item — `plaid_items.env`
 * — and this picks the credentials to match.
 *
 * TWO SECRETS, ONE CLIENT ID. Plaid's client id is the same in both
 * environments; only the secret differs. `PLAID_SECRET` stays the
 * production one so nothing that already works has to be re-entered,
 * and `PLAID_SECRET_SANDBOX` is the new name.
 *
 * ONLY THE ONE ASKED FOR IS REQUIRED. A project with no sandbox
 * secret serves production perfectly; it fails, by name, the first
 * time something asks for sandbox.
 *
 * THE NAMES OF SECRETS ARE NOT SECRET; their values are, and no value
 * is ever logged, returned, or put in an error message. Same shape as
 * `_shared/apple.ts` so the two read alike.
 */
export function readConfig(forEnv?: string): { config: PlaidConfig } | { missing: string[] } {
  const clientId = Deno.env.get("PLAID_CLIENT_ID") ?? "";
  const env = forEnv ?? defaultEnv();
  if (!env) return { missing: [...(clientId ? [] : ["PLAID_CLIENT_ID"]), "PLAID_ENV"] };
  // An unrecognized environment is a missing one rather than a guess:
  // defaulting to production because somebody typed "Sandbox" would
  // point sandbox credentials at real people's banks.
  if (!isPlaidEnv(env)) {
    return { missing: [`PLAID_ENV (got "${env}", expected sandbox or production)`] };
  }
  const name = env === "sandbox" ? "PLAID_SECRET_SANDBOX" : "PLAID_SECRET";
  const secret = Deno.env.get(name) ?? "";
  const missing = [...(clientId ? [] : ["PLAID_CLIENT_ID"]), ...(secret ? [] : [name])];
  if (missing.length) return { missing };
  const baseUrl = env === "sandbox" ? "https://sandbox.plaid.com" : "https://production.plaid.com";
  return { config: { clientId, secret, env, baseUrl } };
}

export interface PlaidError {
  /** Plaid's own `error_code`, e.g. ITEM_LOGIN_REQUIRED. */
  code: string;
  /** Safe to show a developer. NEVER contains a token. */
  message: string;
  status: number;
}

/** Every call to Plaid goes through here, and every one of them is logged. */
export async function callPlaid<T>(
  config: PlaidConfig,
  endpoint: PlaidEndpoint,
  body: Record<string, unknown>,
  log: { admin: SupabaseLike; userId: string | null; trigger: string },
): Promise<{ data: T } | { error: PlaidError }> {
  const startedAt = Date.now();
  let out: { data: T } | { error: PlaidError };
  try {
    const res = await fetch(`${config.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The credentials go in the body, which is Plaid's own scheme.
      // They are not in the URL and so cannot end up in anyone's logs.
      body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    out = res.ok
      ? { data: json as T }
      : { error: { code: String(json?.error_code ?? "HTTP_" + res.status), message: String(json?.error_message ?? res.statusText), status: res.status } };
  } catch (e) {
    out = { error: { code: "NETWORK", message: e instanceof Error ? e.message : "fetch failed", status: 0 } };
  }

  // THE LOG IS NOT OPTIONAL AND NOT CONDITIONAL. "Pulls per user per
  // month" has to be a query, and a log that only records successes
  // answers a different question than the one being asked.
  //
  // It records THAT a call happened, never what came back: a log that
  // quietly accumulates balances is a second copy of the thing this
  // feature promised not to keep.
  await log.admin.from("plaid_api_log").insert({
    user_id: log.userId,
    trigger: log.trigger,
    endpoint,
    ok: !("error" in out),
    error_code: "error" in out ? out.error.code : null,
    duration_ms: Date.now() - startedAt,
  });

  return out;
}

/**
 * The Plaid error codes that mean "the user has to go back to their
 * bank", as opposed to "try again later".
 *
 * These get a reconnect prompt, not a retry and not silence. A balance
 * that stopped updating but still looks live is worse than no balance:
 * the whole value of the number is that it is current.
 */
const NEEDS_RECONNECT = new Set([
  "ITEM_LOGIN_REQUIRED",
  "ITEM_LOCKED",
  "USER_PERMISSION_REVOKED",
  "USER_ACCOUNT_REVOKED",
  "PENDING_DISCONNECT",
  "PENDING_EXPIRATION",
]);

export const needsReconnect = (code: string): boolean => NEEDS_RECONNECT.has(code);

/** The slice of the supabase-js client these functions actually use. */
// deno-lint-ignore no-explicit-any
export type SupabaseLike = { from: (table: string) => any };

/**
 * Today's date WHERE THE USER IS, not where the server is.
 *
 * This was `new Date().toISOString().slice(0, 10)` until 2026-10-20,
 * which is the UTC date — so a balance pulled at 8:46 PM Eastern on
 * the 20th was filed as the 21st, a day that had not started yet for
 * the person it belonged to. A snapshot date is not cosmetic here:
 * it is the forecast's anchor and the key of the row
 * (`<accountId>:<YYYY-MM-DD>`), so a date that is off by one puts
 * the reading on the wrong day in the Ledger and the Calendar, and
 * makes it lose a collision with a manual log it should have won.
 *
 * A TIMEZONE, NOT A DATE, is what the client sends. A client that
 * sent a date could send any date, and the anchor is the one value
 * in this app where a bad one is load-bearing — "2099-01-01" would
 * move the whole forecast. An IANA zone name cannot do that: the
 * worst it yields is today ± 1, which is the true range anyway.
 * `Intl` validates the name itself by throwing on a bad one.
 *
 * `en-CA` because its short date format IS `YYYY-MM-DD`. That is a
 * trick rather than a coincidence, so it is written down.
 */
export function localDateIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(now);
    } catch {
      // An unknown zone falls through to UTC rather than failing the
      // pull. A balance filed on the wrong day is a bug; no balance
      // at all is a worse one.
    }
  }
  return now.toISOString().slice(0, 10);
}
