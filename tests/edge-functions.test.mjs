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
import { PLAID_ENDPOINTS, PRODUCTS, localDateIn } from "../supabase/functions/_shared/plaid.ts";
import {
  constantTimeEquals, sha256Hex, verifyPlaidWebhook,
} from "../supabase/functions/_shared/webhookVerify.ts";

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
  eq("exactly these eight, spelled exactly this way", paths, [
    "/accounts/balance/get",
    "/institutions/get_by_id",
    "/item/get",
    "/item/public_token/exchange",
    "/item/remove",
    "/link/token/create",
    "/link/token/get",
    "/webhook_verification_key/get",
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

console.log("\n== what day it is where the USER is ==");

// THE BUG THIS PINS, from the first real sandbox connection: a pull
// at 8:46 PM Eastern on the 20th was filed as the 21st, because the
// server stamped it with `new Date().toISOString().slice(0, 10)` —
// the UTC date, and UTC had already rolled over.
//
// A snapshot date is not cosmetic. It is the forecast's anchor and
// the primary key of the row (`<accountId>:<YYYY-MM-DD>`), so one
// day out puts the reading on the wrong day in the Ledger and the
// Calendar, and makes it lose a collision with a manual log it
// should have won.
{
  const evening = new Date("2026-10-21T00:46:00Z"); // 8:46 PM Eastern, the 20th
  eq("8:46 PM Eastern on the 20th is the 20th", localDateIn("America/New_York", evening), "2026-10-20");
  eq("...and UTC's own answer, which is the bug, is the 21st", localDateIn(null, evening), "2026-10-21");
  eq("...and in London it really is the 21st", localDateIn("Europe/London", evening), "2026-10-21");

  // The other side of the date line, which the Eastern case alone
  // would not catch: a morning in Auckland is still yesterday in UTC.
  const morning = new Date("2026-10-20T20:00:00Z"); // 9am the 21st in Auckland
  eq("9am in Auckland is already tomorrow", localDateIn("Pacific/Auckland", morning), "2026-10-21");
  eq("...while UTC is still on the 20th", localDateIn(null, morning), "2026-10-20");

  // Midday anywhere is the same day everywhere nearby — a sanity
  // check that this is not just adding a day.
  eq("midday UTC is the same day in New York",
    localDateIn("America/New_York", new Date("2026-10-20T16:00:00Z")), "2026-10-20");
}

// A BAD ZONE FALLS BACK rather than failing the pull. A balance
// filed on the wrong day is a bug; no balance at all is a worse one.
{
  const t = new Date("2026-10-21T00:46:00Z");
  eq("an unknown zone falls back to UTC", localDateIn("Not/AZone", t), "2026-10-21");
  eq("an empty string does too", localDateIn("", t), "2026-10-21");
  eq("and so does nothing at all", localDateIn(undefined, t), "2026-10-21");
}

// IT TAKES A ZONE, NOT A DATE, and that is a security property
// rather than a style choice: the snapshot date is the anchor, so a
// client that could name the date could move the whole forecast.
// The worst an IANA name can produce is today plus or minus one.
{
  const now = new Date("2026-10-20T16:00:00Z");
  const zones = ["Pacific/Auckland", "Pacific/Kiritimati", "Pacific/Niue", "America/New_York", "UTC"];
  const days = zones.map((z) => localDateIn(z, now));
  is("every zone on earth lands within a day of UTC",
    days.every((d) => ["2026-10-19", "2026-10-20", "2026-10-21"].includes(d)));
}

console.log("\n== is the webhook actually from Plaid ==");
//
// REAL ES256, NOT A DESCRIPTION OF ONE. The verifier is pure Web
// Crypto with the key fetch injected, so this generates a P-256 key
// pair, signs real JWTs with it and hands the public half back
// through `fetchKey`. A test that mocked the crypto would be a test
// of the mock — and this is the one piece of code in the project
// whose whole job is to say no to something an attacker chose.
{
  const enc = new TextEncoder();
  const b64url = (bytes) => Buffer.from(bytes).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const part = (obj) => b64url(enc.encode(JSON.stringify(obj)));

  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: pub.x, y: pub.y, kid: "k1", alg: "ES256", expired_at: null };
  const fetchKey = async (id) => (id === "k1" ? jwk : null);

  async function sign(header, claims) {
    const signing = `${part(header)}.${part(claims)}`;
    const sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, pair.privateKey, enc.encode(signing));
    return `${signing}.${b64url(new Uint8Array(sig))}`;
  }

  const body = JSON.stringify({ webhook_code: "SESSION_FINISHED", link_token: "link-sandbox-1" });
  const now = 1_800_000_000;
  const good = { alg: "ES256", kid: "k1" };
  const claims = async (over = {}) => ({
    iat: now, request_body_sha256: await sha256Hex(body), ...over,
  });

  const verify = (header, over = {}) =>
    verifyPlaidWebhook({ header, body, fetchKey, now, ...over });

  is("a real Plaid webhook is accepted", (await verify(await sign(good, await claims()))).ok);

  // THE CLASSIC JWT HOLE, closed twice over. Removing the alg check
  // does NOT make this verifier accept `none` — it hardcodes
  // ECDSA/P-256 and never dispatches on `alg`, so a forgery still
  // dies on the signature. What these two pin is that it is refused
  // FOR BEING THE WRONG ALGORITHM, early and by name, because the
  // structure that makes it safe today is the kind that gets
  // refactored tomorrow.
  const forged = `${part({ alg: "none", kid: "k1" })}.${part(await claims())}.`;
  eq("alg=none is refused, and refused for being alg=none",
    (await verify(forged)).reason, "bad_alg:none");
  eq("so is HS256, which a shared-secret forgery would use",
    (await verify(`${part({ alg: "HS256", kid: "k1" })}.${part(await claims())}.x`)).reason,
    "bad_alg:HS256");

  // THE STEP THAT TIES THE SIGNATURE TO THIS BODY. Without it a
  // valid signature over somebody else's payload authenticates any
  // payload at all, which is the whole attack this is for.
  eq("a valid signature over a DIFFERENT body is refused",
    (await verifyPlaidWebhook({
      header: await sign(good, await claims()), body: body + " ", fetchKey, now,
    })).reason, "body_mismatch");
  eq("...and a claim with no hash in it at all",
    (await verify(await sign(good, { iat: now }))).reason, "no_body_hash");

  // A signature is valid forever; freshness is what stops yesterday's
  // captured webhook being replayed.
  eq("six minutes old is too old",
    (await verify(await sign(good, await claims({ iat: now - 6 * 60 })))).reason, "stale");
  is("four minutes old is fine",
    (await verify(await sign(good, await claims({ iat: now - 4 * 60 })))).ok);
  eq("no iat, no verdict", (await verify(await sign(good, { request_body_sha256: await sha256Hex(body) }))).reason, "no_iat");

  // The key itself.
  eq("an unknown kid", (await verify(await sign({ alg: "ES256", kid: "nope" }, await claims()))).reason, "unknown_key");
  eq("a RETIRED key is refused — Plaid still serves them",
    (await verifyPlaidWebhook({
      header: await sign(good, await claims()), body, now,
      fetchKey: async () => ({ ...jwk, expired_at: 1_700_000_000 }),
    })).reason, "expired_key");

  // Signed by someone else's key, with everything else right.
  const impostor = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const signing = `${part(good)}.${part(await claims())}`;
  const badSig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, impostor.privateKey, enc.encode(signing));
  eq("another key's signature is refused",
    (await verify(`${signing}.${b64url(new Uint8Array(badSig))}`)).reason, "bad_signature");

  // And the shapes that are not tokens.
  eq("no header at all", (await verify(null)).reason, "no_verification_header");
  eq("not a JWT", (await verify("hello")).reason, "malformed_jwt");

  // The hash comparison does not leak where it stopped matching.
  is("equal is equal", constantTimeEquals("abc", "abc"));
  not("different length", constantTimeEquals("abc", "abcd"));
  not("same length, one character out", constantTimeEquals("abc", "abd"));

  // And the wiring: the verifier is worth nothing if the handler
  // does not call it BEFORE it spends anything, on the RAW body.
  const exchange = readFileSync(new URL("../supabase/functions/plaid-exchange/index.ts", import.meta.url), "utf8");
  is("the handler verifies", exchange.includes("verifyPlaidWebhook("));
  is("...on the raw text it received, not a re-stringify",
    exchange.includes("body: raw,") && exchange.includes("await req.text()"));
  not("...and never re-serializes the body", exchange.includes("JSON.stringify(payload)"));
  is("...before the link/token/get that costs a call",
    exchange.indexOf("verifyPlaidWebhook(") < exchange.indexOf("PLAID_ENDPOINTS.linkTokenGet"));
  is("a refused webhook is a 401, not a quiet 200",
    exchange.includes('return json(401, { error: "unverified"'));
  // AND THE GUARD IS REACHED, not merely present. The check above
  // passes just as happily when the branch has been turned off —
  // `if (false)` leaves every string in this file exactly where it
  // was, and the mutation runner found that on 2026-10-21 by
  // turning it off and watching the whole gate stay green.
  //
  // THIS IS A TEXT CHECK STANDING IN FOR A RUN, and it is worth
  // saying so rather than letting it read as more than it is: the
  // handler is Deno, there is no Deno on this machine, and the
  // nearest honest thing is to pin the expression that decides.
  is("...and the guard that reaches it is the verifier's own verdict",
    exchange.includes("if (!verified.ok) {"));

  // The comparison's property is that it does NOT stop at the first
  // difference, which no behavioral test can see — `a === b` returns
  // the same answers, just sooner for an attacker who is measuring.
  // So this reads the function, which is where the property lives.
  {
    const src = readFileSync(new URL("../supabase/functions/_shared/webhookVerify.ts", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("export function constantTimeEquals"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    not("the hash comparison does not short-circuit", /return a === b/.test(body));
    is("...it folds every character before deciding", body.includes("diff |="));
  }
}

console.log("\n== one project, two Plaid environments ==");
// PLAID_ENV was a single secret for the whole project, so sandbox
// testing and a live connection were mutually exclusive: flipping it
// pointed a real access token at the wrong host and every pull
// failed. An access token belongs to the environment it was minted
// in, so the environment belongs on the Item.
{
  // readConfig cannot be called here — it reads Deno.env — but its
  // SHAPE is checkable, and the shape is the decision.
  const shared = readFileSync(new URL("../supabase/functions/_shared/plaid.ts", import.meta.url), "utf8");
  is("the secret name follows the environment",
    shared.includes('env === "sandbox" ? "PLAID_SECRET_SANDBOX" : "PLAID_SECRET"'));
  is("...and production keeps the name that already works",
    shared.includes('"PLAID_SECRET"') && !shared.includes("PLAID_SECRET_PRODUCTION"));
  // ONLY THE ONE ASKED FOR. A project with no sandbox secret serves
  // production perfectly and fails, by name, the first time
  // something asks for sandbox.
  is("only the secret for the environment asked for is required",
    shared.includes("...(secret ? [] : [name])"));
  is("an unrecognized environment is refused, never guessed",
    shared.includes('expected sandbox or production'));
  is("PLAID_ENV is demoted to the default for a NEW connection",
    shared.includes("export const defaultEnv"));

  // Every call about an existing connection uses that Item's env.
  for (const [who, path, needle] of [
    ["the balance pull", "../supabase/functions/plaid-balance/index.ts", "readConfig(item.env ?? undefined)"],
    ["disconnect", "../supabase/functions/plaid-disconnect/index.ts", "readConfig(item.env ?? undefined)"],
    ["the removal drain", "../supabase/functions/plaid-disconnect/index.ts", "readConfig(row.env ?? undefined)"],
    ["the exchange", "../supabase/functions/plaid-exchange/index.ts", "const conf = readConfig(env);"],
    ["minting a Link token", "../supabase/functions/plaid-link-token/index.ts", "readConfig(env)"],
  ]) {
    is(`${who} uses the stored environment`, readFileSync(new URL(path, import.meta.url), "utf8").includes(needle));
  }

  const link = readFileSync(new URL("../supabase/functions/plaid-link-token/index.ts", import.meta.url), "utf8");
  is("a new connection takes the person's own default, then the project's",
    link.includes("existing?.env ?? beta?.env ?? defaultEnv()"));
  is("...and the session remembers which one it was minted in",
    link.includes("user_id: userId, env }"));

  const exchange = readFileSync(new URL("../supabase/functions/plaid-exchange/index.ts", import.meta.url), "utf8");
  is("the Item is stored with its environment", /institution_name: institutionName,\n\s+\/\/[^\n]*\n\s+env,/.test(exchange));
  is("a queued removal carries one too, since the drain outlives the Item",
    exchange.includes("p_env: env"));
  // Plaid's webhook signing keys are per environment, so a cache
  // keyed on kid alone would hand a sandbox key to a production
  // webhook the moment both are in use.
  is("the verification key cache is keyed by environment as well as kid",
    exchange.includes("keyCache.get(`${env}:${keyId}`)"));

  const sql = readFileSync(new URL("../supabase/plaid.sql", import.meta.url), "utf8");
  for (const t of ["plaid_items", "plaid_link_sessions", "plaid_removals", "plaid_beta"]) {
    is(`${t} has an env column`,
      new RegExp(`alter table ${t}\\s+add column if not exists env text`).test(sql));
  }
  is("the existing rows were backfilled, not left null",
    sql.includes("update plaid_items         set env = 'production' where env is null;"));
  is("the removal queue takes it as an argument",
    sql.includes("p_access_token text, p_plaid_item_id text, p_env text default 'production'"));
  is("and account deletion carries it off the Item before the Item goes",
    sql.includes("coalesce(it.env, 'production')"));
}

console.log("\n== a webhook is a backup, not the only way home ==");
// 2026-10-21, production, a real bank: TD Bank completed at Plaid
// and SESSION_FINISHED never reached us. The Item was live, the
// Trial slot was spent, and Settings showed "Connect your bank" —
// so the only route the user could see would have cost a second
// slot out of ten. Hosted Link having exactly one completion path,
// and that path being a message from a third party over the public
// internet, was the design error. These pin the way out.
{
  const exchange = readFileSync(new URL("../supabase/functions/plaid-exchange/index.ts", import.meta.url), "utf8");
  // THE WEBHOOK THAT ACTUALLY FIRES. Matching SESSION_FINISHED
  // alone lost a real production Item: three webhook invocations
  // landed in the ninety seconds after the user finished and not
  // one of them was SESSION_FINISHED, so all three took the
  // 200-and-ignore branch. Plaid fires ITEM_ADD_RESULT for each
  // Item as it is added in a Hosted Link session; SESSION_FINISHED
  // waits for the whole session to end, which in an in-app browser
  // the user simply closes may be much later or never.
  is("the per-Item webhook is handled, not just the session one",
    exchange.includes('payload.webhook_code === "ITEM_ADD_RESULT"'));
  is("...and the session one still is", exchange.includes('payload.webhook_code === "SESSION_FINISHED"'));
  // Its body carries a public_token. Still not read from there: the
  // answer comes from /link/token/get, so a forgery can only make
  // us ask Plaid a question.
  // Scoped to the webhook branch — `payload.public_token` is the
  // WEB path's whole input, where reading it is correct.
  const hook = exchange.slice(
    exchange.indexOf('payload.webhook_code === "SESSION_FINISHED"'),
    exchange.indexOf("// ---- FINISH A SESSION THE WEBHOOK NEVER FINISHED ----"));
  not("the public token is never taken from a webhook body", hook.includes("payload.public_token"));
  is("...it is asked for, through link/token/get", hook.includes("PLAID_ENDPOINTS.linkTokenGet"));
  is("the server can finish a session on request", exchange.includes("payload.recover === true"));
  is("...authenticated as the caller, by their own token",
    exchange.slice(exchange.indexOf("payload.recover === true")).includes("userId = await callerId(req)"));
  // The rescue door written during the incident is gone. It keyed on
  // a key comparison first and then on the link token, and the
  // second one was refused as weakening security — rightly, it was
  // an unauthenticated way to exchange a bank token.
  // Scoped to the recover branch: `payload.link_token` is also
  // Plaid's own field in SESSION_FINISHED, where it is the whole
  // point, so a file-wide grep would fail for the wrong reason.
  const recoverBranch = exchange.slice(
    exchange.indexOf("payload.recover === true"),
    exchange.indexOf("// Every other webhook Plaid sends"));
  not("...and no operator door survives it", recoverBranch.includes("payload.user_id"));
  not("...nor one keyed on the link token itself", recoverBranch.includes("payload.link_token"));

  // A session marked used is a session recover cannot find, so the
  // web path must not spend it until the Item is actually stored.
  const webPath = exchange.indexOf("the web path: an authenticated client");
  const stored = exchange.indexOf("await standDown();");
  const spends = exchange.indexOf('.update({ used_at: new Date().toISOString() })\n    .eq("user_id", userId)');
  is("the web path spends its session only after the Item is stored", spends > stored && spends > webPath);

  // And the evidence that was missing on the day.
  is("an arriving webhook is written down, verdict and all", exchange.includes("async function noteInbound("));
  is("...including the ones we refuse", exchange.includes("verified.reason, String(payload.webhook_type"));
  is("...and the ones we do not handle, so 'never arrived' is provable",
    exchange.includes('noteInbound(admin, payload.webhook_code, "unhandled"'));
  is("...with the type beside the code, which was the missing half of the question",
    exchange.includes("(inbound) ${type ? `${type}/` : \"\"}${code}"));
}

// Both clients ask rather than wait, and in all three places a
// session can be left unfinished: coming back from the browser,
// foregrounding the app, and a cold start.
{
  const connected = readFileSync(new URL("../mobile/components/Connected.tsx", import.meta.url), "utf8");
  const chrome = readFileSync(new URL("../mobile/components/Chrome.tsx", import.meta.url), "utf8");
  const web = readFileSync(new URL("../src/components/ConnectedAccount.jsx", import.meta.url), "utf8");
  is("the phone asks the moment the browser closes",
    connected.slice(connected.indexOf("openAuthSessionAsync(started.hostedUrl)")).includes("recoverLink("));
  is("...and again on foreground when it has no bank",
    connected.includes("if (!connectionNow()) await recoverLink("));
  is("...and on a cold start, which neither of those covers",
    chrome.includes("!connectionNow()") && chrome.includes("recoverLink("));
  is("the web asks too, for a tab closed mid-exchange", web.includes("recoverLink(supabase)"));
  // AND THEN RE-READS, which asking does not imply. Recovery stores
  // the Item and pulls a balance server-side, so a page that only
  // asks is a page still showing the figures from before the
  // connection existed — "Use bank balance did nothing until I
  // refreshed", one screen over. SCOPED TO THE RECOVER BLOCK: this
  // file calls `refresh()` five times, and a whole-file match passes
  // happily while this branch is the one that drops it.
  const recovered = web.slice(web.indexOf("const found = await recoverLink"), web.indexOf("onChanged?.(true)"));
  is("...and the web re-reads the connection once recovery succeeds", recovered.includes("await refresh();"));
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S) of ${checks}`);
process.exit(failures === 0 ? 0 : 1);
