// CORS for the functions a BROWSER calls, and an allowlist rather
// than a wildcard.
//
// WHY THIS DID NOT EXIST UNTIL 2026-10-20. Every edge function in
// this project was written for the phone, which is not a browser and
// sends no Origin — so none of them had ever needed a preflight to
// succeed. The web's first Connect failed on `OPTIONS
// /functions/v1/plaid-link-token` with no `Access-Control-Allow-Origin`
// in the response, and the giveaway in the logs was that the function
// BOOTED and `plaid_api_log` stayed empty: the browser never sent the
// POST, so the handler never ran.
//
// NO WILDCARD. `Access-Control-Allow-Origin: *` cannot be used with
// credentials anyway, but the real reason is narrower: these
// functions mint Link tokens and remove bank connections on behalf of
// whoever's JWT is attached. The set of pages allowed to ask is
// small, known, and worth writing down.
//
// THE ORIGIN IS ECHOED, NOT LISTED. The header takes one origin, so
// an allowlist is implemented by echoing the request's own origin
// back when it is on the list and sending no header at all when it is
// not. `Vary: Origin` goes with it, or a cache can hand one origin's
// response to another.

/**
 * Where the web app is actually served from.
 *
 * `key-budget-app.vercel.app` IS A LOAN, not a decision. It is still
 * a live origin today, which is why it is here — a CORS list that
 * omits an origin the app is served from is just the same bug
 * somewhere else. It is also already on the roadmap for deletion
 * (§10, item 27: "a second origin that can complete an auth redirect
 * is a second thing to get wrong"), and **that item now has a second
 * line to delete.** Remove the domain and remove this entry in the
 * same commit.
 *
 * Localhost is dev only and harmless in production: an attacker who
 * can serve from your localhost has already won by other means.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  "https://keybudget.app",
  "https://key-budget-app.vercel.app",
  "http://localhost:5173",
];

/**
 * The headers supabase-js actually sends on a function call.
 *
 * `authorization` and `apikey` come from the base client,
 * `x-client-info` from supabase-js itself, `content-type` from the
 * JSON body. `x-supabase-api-version` is included because newer
 * clients send it and a preflight that omits one header the browser
 * announces fails whole — the failure mode is silent at the server,
 * which is exactly how this bug went unnoticed in the first place.
 */
const ALLOWED_HEADERS = "authorization, apikey, x-client-info, content-type, x-supabase-api-version";

/**
 * The CORS headers for one request's origin, or none.
 *
 * AN UNKNOWN ORIGIN GETS NO HEADER AT ALL rather than a rejection:
 * that is how CORS says no, and inventing a 403 would turn a browser
 * rule into a server error for the many callers that are not
 * browsers.
 *
 * AN ABSENT ORIGIN ALSO GETS NONE, which is the case that matters for
 * `plaid-exchange`: Plaid's webhook is server-to-server and sends no
 * Origin, so it takes this path and is unaffected by any of it.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  // `Vary` is sent whether or not the origin matched. Without it a
  // shared cache can store the allowed response and replay it to an
  // origin that was never allowed.
  const vary = { "Vary": "Origin" };
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return vary;
  return {
    ...vary,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // The browser may skip the preflight for a day. Long enough to
    // matter, short enough that changing the list is not a week-long
    // rollout.
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Answer a preflight, or return null to say "this was not one".
 *
 * Called as the FIRST thing in every browser-reachable handler,
 * before the method check — `OPTIONS` is not `POST`, so a handler
 * that checks the method first answers 405 to a preflight and the
 * real request never happens.
 */
export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("Origin")) });
}
