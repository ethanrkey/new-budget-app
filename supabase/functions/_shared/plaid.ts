// Everything the Plaid edge functions share: the config, the one way to
// call Plaid, the one way to log that we did, and the numbers that are
// policy rather than implementation.
//
// THE RULE THIS FILE ENFORCES: balance only. `callPlaid` is the only
// door to Plaid in this codebase, and the endpoints below are the only
// ones it is ever asked for. /auth/get and /identity/get are not here
// and must not be added — see PRODUCTS for why one of them is named in
// the Link token anyway.

export const PLAID_ENDPOINTS = {
  linkTokenCreate: "/link/token/create",
  linkTokenGet: "/link/token/get",
  itemPublicTokenExchange: "/item/public_token_exchange",
  accountsBalanceGet: "/accounts/balance/get",
  itemGet: "/item/get",
  institutionsGetById: "/institutions/get_by_id",
  itemRemove: "/item/remove",
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

/**
 * Read the three secrets, naming any that are missing.
 *
 * THE NAMES OF SECRETS ARE NOT SECRET; their values are, and no value
 * is ever logged, returned, or put in an error message. Same shape as
 * `_shared/apple.ts` so the two read alike.
 */
export function readConfig(): { config: PlaidConfig } | { missing: string[] } {
  const clientId = Deno.env.get("PLAID_CLIENT_ID") ?? "";
  const secret = Deno.env.get("PLAID_SECRET") ?? "";
  const env = Deno.env.get("PLAID_ENV") ?? "";
  const missing = [
    ...(clientId ? [] : ["PLAID_CLIENT_ID"]),
    ...(secret ? [] : ["PLAID_SECRET"]),
    ...(env ? [] : ["PLAID_ENV"]),
  ];
  if (missing.length) return { missing };
  // An unrecognized environment is a missing one rather than a guess:
  // defaulting to production because somebody typed "Sandbox" would
  // point sandbox credentials at real people's banks.
  const baseUrl = env === "sandbox" ? "https://sandbox.plaid.com"
    : env === "production" ? "https://production.plaid.com"
    : "";
  if (!baseUrl) return { missing: [`PLAID_ENV (got "${env}", expected sandbox or production)`] };
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

/** Today in the user's own terms. */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
