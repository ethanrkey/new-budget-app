// The edge functions' contract with the outside world: the CORS the
// browser needs, and the Plaid paths that have to be spelled right.
//
//   node tests/edge-functions.test.mjs     (runs in `npm test`, so in CI)
//
// Neither half can be checked by running the functions — they are
// Deno, and one of them talks to a bank. Both halves are checked by
// importing the pure modules the functions import, and by reading
// the handlers as text for the wiring. Two real bugs reached a user
// through this gap on 2026-10-20 and both are pinned below.
//
// WHY THIS FILE EXISTS. Every edge function in this project was
// written for the phone, which is not a browser and sends no Origin,
// so no preflight had ever had to succeed. The web's first Connect
// died on `OPTIONS /functions/v1/plaid-link-token` with no
// Access-Control-Allow-Origin, and the tell in the logs was that the
// function BOOTED while plaid_api_log stayed empty — the browser
// never sent the POST, so nothing server-side noticed anything was
// wrong. A failure that silent deserves a test.
//
// `_shared/cors.ts` is deliberately free of Deno APIs so the real
// module can be imported and asked real questions here, rather than
// having its behavior described by a test that cannot run it.
import { readFileSync } from "node:fs";
import { ALLOWED_ORIGINS, corsHeaders, preflight } from "../supabase/functions/_shared/cors.ts";
import { PLAID_ENDPOINTS, PRODUCTS } from "../supabase/functions/_shared/plaid.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, c) => eq(label, !!c, true);
const not = (label, c) => eq(label, !!c, false);

const ACAO = "Access-Control-Allow-Origin";

console.log("\n== the allowlist ==");

// The origins the web app is actually served from. vercel.app is a
// loan tied to roadmap item 27 — when that domain goes, this entry
// goes with it, and this test is the thing that will say so.
eq("exactly the origins the app is served from", [...ALLOWED_ORIGINS].sort(),
  ["http://localhost:5173", "https://key-budget-app.vercel.app", "https://keybudget.app"]);

for (const origin of ALLOWED_ORIGINS) {
  // ECHOED, NOT LISTED. The header takes one origin, so an allowlist
  // is "send back the one that asked, if it is on the list".
  eq(`${origin} is echoed back exactly`, corsHeaders(origin)[ACAO], origin);
}

console.log("\n== and everything that is not on it ==");
for (const origin of ["https://evil.example", "http://keybudget.app", "https://keybudget.app.evil.com",
                      "https://www.keybudget.app", "http://localhost:5174", "null"]) {
  eq(`${origin} gets no allow-origin header at all`, corsHeaders(origin)[ACAO], undefined);
}
// http:// vs https:// and a suffix match are the two ways an
// allowlist is usually got wrong; both are covered above because
// `includes` is an exact string match and not a prefix test.
eq("a request with no Origin gets none either — the webhook's path",
  corsHeaders(null)[ACAO], undefined);

// NEVER A WILDCARD. It cannot carry credentials anyway, but the real
// reason is that these functions mint Link tokens and remove bank
// connections on behalf of whoever's JWT is attached.
for (const origin of [...ALLOWED_ORIGINS, "https://evil.example", null]) {
  not(`never a wildcard (${origin})`, corsHeaders(origin)[ACAO] === "*");
}

// Vary goes out EVERY time, matched or not: without it a shared cache
// can store the allowed response and replay it to an origin that was
// never allowed.
for (const origin of ["https://keybudget.app", "https://evil.example", null]) {
  eq(`Vary: Origin is always sent (${origin})`, corsHeaders(origin)["Vary"], "Origin");
}

console.log("\n== the preflight itself ==");
const opt = (origin, method = "OPTIONS") =>
  preflight(new Request("https://x.test/functions/v1/plaid-link-token", {
    method, headers: origin ? { Origin: origin } : {},
  }));

{
  const res = opt("http://localhost:5173");
  is("an OPTIONS from an allowed origin is answered here", !!res);
  eq("...with 204 and no body", res.status, 204);
  eq("...and the origin echoed", res.headers.get(ACAO), "http://localhost:5173");
  eq("...and POST allowed", res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  // EVERY HEADER supabase-js ANNOUNCES, or the preflight fails whole.
  // Omitting one is silent at the server, which is how the original
  // bug stayed invisible.
  const allowed = (res.headers.get("Access-Control-Allow-Headers") ?? "").split(",").map((h) => h.trim());
  for (const h of ["authorization", "apikey", "x-client-info", "content-type"]) {
    is(`...and allows ${h}`, allowed.includes(h));
  }
}
{
  const res = opt("https://evil.example");
  is("an OPTIONS from anywhere else is still answered", !!res);
  eq("...but carries no allow-origin, which is how CORS says no", res.headers.get(ACAO), null);
}
eq("a POST is not a preflight and falls through to the handler", opt("https://keybudget.app", "POST"), null);

console.log("\n== every browser-called function is wired to it ==");

// THE SOURCE CHECK, because the logic above can be perfect while a
// function forgets to call it. plaid-exchange IS on this list: the
// web posts the public_token to it from the page (finishLink in
// src/shared/plaidApi.ts), and leaving it out would have moved the
// failure from the first step of connecting to the last — after the
// Item already existed at Plaid and this app had no record of it.
const BROWSER_CALLED = ["plaid-link-token", "plaid-balance", "plaid-disconnect", "plaid-exchange"];
for (const fn of BROWSER_CALLED) {
  const src = readFileSync(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), "utf8");
  is(`${fn} imports the shared helper`, src.includes('from "../_shared/cors.ts"'));
  is(`${fn} answers the preflight`, /const pre = preflight\(req\);\s*\n\s*if \(pre\) return pre;/.test(src));
  // BEFORE THE METHOD CHECK. OPTIONS is not POST, so a handler that
  // checks the method first answers 405 to the preflight and the real
  // request is never sent.
  is(`${fn} does it BEFORE the method check`,
    src.indexOf("const pre = preflight(req)") < src.indexOf('req.method !== "POST"'));
  // And every reply carries the headers — a preflight that passes
  // followed by a response without them is still a blocked call.
  is(`${fn} binds its responses to the request's origin`, src.includes("const json = responder(req);"));
  not(`${fn} has no origin-less json left`, /\bjson = \(status/.test(src));
}

console.log("\n== the Plaid endpoint paths ==");

// WRITTEN OUT, because one of them was wrong for a day and nothing
// here could have known. `/item/public_token_exchange` (underscore)
// is not an endpoint; `/item/public_token/exchange` (slash) is.
// Plaid answers the first with NOT_FOUND, which reads as "that token
// does not exist" and means "that URL does not exist" — so the first
// sandbox connection failed AFTER Link succeeded, pointing at the
// wrong half of the system.
//
// These are external facts, like the Supabase dashboard settings in
// §5a, so the test pins the literal strings: a change has to be
// deliberate. Each was verified against sandbox on 2026-10-20 with
// an unauthenticated POST — Plaid answers MISSING_FIELDS when an
// endpoint exists and NOT_FOUND when it does not, which needs no
// credentials and is the check to re-run before adding one.
{
  const paths = Object.values(PLAID_ENDPOINTS).sort();
  eq("exactly these seven, spelled exactly this way", paths, [
    "/accounts/balance/get",
    "/institutions/get_by_id",
    "/item/get",
    "/item/public_token/exchange",
    "/item/remove",
    "/link/token/create",
    "/link/token/get",
  ]);
  // The one that bit, called out by name so a future edit has to
  // walk past it.
  eq("the exchange path has a SLASH before 'exchange', not an underscore",
    PLAID_ENDPOINTS.itemPublicTokenExchange, "/item/public_token/exchange");
  // And the products array, which decides what Plaid's own consent
  // screen lists. Identity drops the routing-number scope that Auth
  // would add; confirmed on the real screen 2026-10-20.
  eq("one product, and it is identity", [...PRODUCTS], ["identity"]);
  not("the Transactions product is never requested", PRODUCTS.includes("transactions"));
  not("...nor Auth", PRODUCTS.includes("auth"));
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S) of ${checks}`);
process.exit(failures === 0 ? 0 : 1);
