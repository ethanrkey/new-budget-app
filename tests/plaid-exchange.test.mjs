// plaid-exchange, RUN: the real handler, with a pretend database and a
// pretend Plaid.
//
//   node tests/plaid-exchange.test.mjs     (runs in `npm test`, so in CI)
//
// 2026-11-03, production: Capital One over OAuth from iOS, Hosted Link.
// Every Plaid step finished; the app came back to "Connect your bank".
// Rescued at 22:34 UTC with the public token about 15 minutes from
// expiry. Three things were wrong, and each has a case here:
//
//   1. recover asked about the NEWEST open session only. She tapped
//      Connect twice more, each new session became the newest, recover
//      asked about those, found nothing, and never asked about the
//      session that held the Item.
//   2. Only `link_sessions[0]` of Plaid's answer was read. An OAuth bank
//      sends the user away and back, and the token can be in another.
//   3. ANY empty answer closed the session for good, so one early ask
//      (results not written yet) made it unrecoverable.
//
// The handler is bundled from supabase/functions/plaid-exchange/index.ts
// AS DEPLOYED. Only the modules that reach the outside world are swapped
// (the database client and the caller, Plaid's HTTP call, the webhook
// signature check); linkResult.ts and cors.ts are the real ones.
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { publicTokenOf, exitedWithNoItem } from "../supabase/functions/_shared/linkResult.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}

// ---- What a session in Plaid's answer looks like ---------------------
const empty = (at) => ({ link_session_id: `s-${at}`, started_at: at, finished_at: null, results: { item_add_results: [] } });
const withItem = (at, token) => ({ link_session_id: `s-${at}`, started_at: at, finished_at: at, results: { item_add_results: [{ public_token: token }] } });
const exited = (at) => ({ link_session_id: `s-${at}`, started_at: at, finished_at: at, results: null, exit: { error: null } });

console.log("\n== reading Plaid's answer ==");
eq("the token in the FIRST session entry is found", publicTokenOf({ link_sessions: [withItem("22:20:30", "pt-a")] }), "pt-a");
eq("...and in a LATER entry, after an empty one (the OAuth bounce)",
  publicTokenOf({ link_sessions: [empty("22:20:05"), withItem("22:21:10", "pt-oauth")] }), "pt-oauth");
eq("...and in the older on_success field",
  publicTokenOf({ link_sessions: [{ started_at: "22:20", on_success: { public_token: "pt-legacy" } }] }), "pt-legacy");
eq("...and in a later item_add_result than the first", publicTokenOf({ link_sessions: [{ started_at: "1", results: { item_add_results: [{}, { public_token: "pt-2" }] } }] }), "pt-2");
eq("no sessions is no token", publicTokenOf({}), "");
eq("an empty answer is NOT the user backing out", exitedWithNoItem({ link_sessions: [empty("22:20")] }), false);
eq("...nor is an answer with no sessions yet", exitedWithNoItem({ link_sessions: [] }), false);
eq("an exit with no Item is", exitedWithNoItem({ link_sessions: [exited("22:20")] }), true);
eq("...but not if another entry has the Item", exitedWithNoItem({ link_sessions: [exited("22:20"), withItem("22:21", "pt")] }), false);

// ---- The handler -----------------------------------------------------
const FAKES = `
export const PLAID_ENDPOINTS = {
  linkTokenGet: "/link/token/get", itemPublicTokenExchange: "/item/public_token/exchange",
  accountsBalanceGet: "/accounts/balance/get", itemGet: "/item/get",
  institutionsGetById: "/institutions/get_by_id", webhookVerificationKeyGet: "/webhook_verification_key/get",
};
export const callPlaid = (...a) => globalThis.__plaid(...a);
export const defaultEnv = () => "production";
export const readConfig = (env) => ({ config: { env: env || "production" } });
export const responder = () => (status, body) => new Response(JSON.stringify(body), { status });
export const adminClient = () => globalThis.__db;
export const callerId = async () => globalThis.__caller;
export const isAllowlisted = async () => true;
export const verifyPlaidWebhook = async () => ({ ok: true });
`;
const out = await build({
  entryPoints: [new URL("../supabase/functions/plaid-exchange/index.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "neutral", logLevel: "silent",
  plugins: [{
    name: "fakes",
    setup(b) {
      b.onResolve({ filter: /_shared\/(caller|plaid|webhookVerify)\.ts$/ }, () => ({ path: "fakes", namespace: "fakes" }));
      b.onLoad({ filter: /.*/, namespace: "fakes" }, () => ({ contents: FAKES, loader: "js" }));
    },
  }],
});
let handler = null;
globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: () => "" } };
const cache = new URL("../node_modules/.cache/plaid-exchange-test/", import.meta.url);
mkdirSync(cache, { recursive: true });
const file = new URL("bundle.mjs", cache);
writeFileSync(file, out.outputFiles[0].text);
await import(file.href);

// A database that answers the handful of query shapes the handler uses.
function makeDb(tables) {
  const rpcs = [];
  const query = (name) => {
    const q = { op: "select", filters: [], patch: null, row: null, order: null, limit: Infinity };
    const rows = () => tables[name] ?? (tables[name] = []);
    const match = (r) => q.filters.every(([k, f, v]) =>
      f === "eq" ? r[k] === v : f === "is" ? (r[k] ?? null) === v : f === "gt" ? String(r[k]) > String(v)
        : f === "in" ? v.includes(r[k]) : true);
    const run = () => {
      if (q.op === "insert") {
        const added = [q.row].flat().map((x) => ({ id: `id-${rows().length + 1}`, ...x }));
        added.forEach((r, i) => { r.id = `id-${rows().length + 1 + i}`; });
        rows().push(...added);
        return { data: added, error: null };
      }
      let hit = rows().filter(match);
      if (q.op === "update") { hit.forEach((r) => Object.assign(r, q.patch)); return { data: hit, error: null }; }
      if (q.op === "delete") { tables[name] = rows().filter((r) => !match(r)); return { data: hit, error: null }; }
      if (q.order) hit = [...hit].sort((a, b) => (q.order.asc ? 1 : -1) * String(a[q.order.k]).localeCompare(String(b[q.order.k])));
      return { data: hit.slice(0, q.limit), error: null };
    };
    const api = {
      select() { return api; },
      eq(k, v) { q.filters.push([k, "eq", v]); return api; },
      is(k, v) { q.filters.push([k, "is", v]); return api; },
      gt(k, v) { q.filters.push([k, "gt", v]); return api; },
      in(k, v) { q.filters.push([k, "in", v]); return api; },
      order(k, o) { q.order = { k, asc: o?.ascending !== false }; return api; },
      limit(n) { q.limit = n; return api; },
      update(p) { q.op = "update"; q.patch = p; return api; },
      insert(r) { q.op = "insert"; q.row = r; return api; },
      delete() { q.op = "delete"; return api; },
      async maybeSingle() { const { data } = run(); return { data: data[0] ?? null, error: null }; },
      async single() { const { data } = run(); return { data: data[0] ?? null, error: data[0] ? null : { message: "none" } }; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return api;
  };
  const db = { tables, rpcs, writes: [], from: query, rpc: async (fn, args) => { rpcs.push(fn); if (fn === "plaid_write_balance") db.writes.push(args); return { data: fn === "plaid_queue_removal" ? 1 : fn === "plaid_write_balance" ? "written" : null, error: null }; } };
  return db;
}

const FUTURE = "2099-01-01T00:00:00Z";
const session = (link_token, created_at, used_at = null) => ({ user_id: "u-poppy", link_token, created_at, used_at, expires_at: FUTURE, env: "production" });

// A pretend Plaid: /link/token/get answers from `answers` by link token.
function makePlaid(answers) {
  const calls = [];
  const fn = async (_conf, endpoint, body) => {
    calls.push(endpoint === "/link/token/get" ? `${endpoint} ${body.link_token}` : endpoint);
    if (endpoint === "/link/token/get") return { data: answers[body.link_token] ?? { link_sessions: [] } };
    if (endpoint === "/item/public_token/exchange") {
      if (body.public_token === "pt-expired") return { error: { code: "INVALID_PUBLIC_TOKEN" } };
      return { data: { access_token: `at-${body.public_token}`, item_id: `item-${body.public_token}` } };
    }
    if (endpoint === "/item/get") return { data: { item: { institution_id: "ins_capone" } } };
    if (endpoint === "/institutions/get_by_id") return { data: { institution: { name: "Capital One" } } };
    if (endpoint === "/accounts/balance/get") return { data: { accounts: [{ account_id: "acc", name: "360 Checking", mask: "1234", balances: { available: 812.4, current: 830 } }] } };
    return { data: {} };
  };
  return { calls, fn };
}
async function call(body, { db, plaid, caller = "u-poppy" }) {
  globalThis.__db = db; globalThis.__plaid = plaid.fn; globalThis.__caller = caller;
  const res = await handler(new Request("https://x/plaid-exchange", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
const usedOf = (db, lt) => db.tables.plaid_link_sessions.find((s) => s.link_token === lt).used_at != null;

console.log("\n== recover, as on 2026-11-03: the Item is in the OLDEST open session ==");
{
  const db = makeDb({ plaid_link_sessions: [
    session("lt-first", "2026-11-03T22:20:00Z"),   // went through Capital One
    session("lt-second", "2026-11-03T22:22:42Z"),  // opened, never got going
    session("lt-third", "2026-11-03T22:24:10Z"),
  ] });
  const plaid = makePlaid({
    // The OAuth bounce: the first entry is empty, the Item is in the next.
    "lt-first": { link_sessions: [empty("22:20:05"), withItem("22:21:10", "pt-capone")] },
    "lt-second": { link_sessions: [empty("22:22:50")] },
    "lt-third": { link_sessions: [empty("22:24:15")] },
  });
  const r = await call({ recover: true }, { db, plaid });
  // No zone sent, so no snapshot: see the balance section below.
  eq("recover connects the bank", r.body, { ok: true, connected: true, institution_name: "Capital One", synced: false });
  eq("...asking newest first, down to the one that has it",
    plaid.calls.filter((c) => c.startsWith("/link/token/get")),
    ["/link/token/get lt-third", "/link/token/get lt-second", "/link/token/get lt-first"]);
  eq("...exchanging exactly once", plaid.calls.filter((c) => c === "/item/public_token/exchange").length, 1);
  eq("...and storing one Capital One item", db.tables.plaid_items.map((i) => [i.institution_name, i.plaid_item_id]), [["Capital One", "item-pt-capone"]]);
  eq("...one slot counted", db.tables.plaid_item_creations.length, 1);
  eq("...and every one of her sessions is closed now", db.tables.plaid_link_sessions.map((s) => s.used_at != null), [true, true, true]);
  eq("...with the safety net stood down", db.rpcs, ["plaid_queue_removal", "plaid_store_token", "plaid_cancel_removal"]);
}

console.log("\n== an empty early answer does not close the session ==");
{
  const db = makeDb({ plaid_link_sessions: [session("lt-1", "2026-11-03T22:20:00Z")] });
  const answers = { "lt-1": { link_sessions: [empty("22:20:05")] } };
  const plaid = makePlaid(answers);
  // The webhook says an Item was added, but Plaid has not written it yet.
  const w = await call({ webhook_type: "LINK", webhook_code: "ITEM_ADD_RESULT", link_token: "lt-1" }, { db, plaid });
  eq("ITEM_ADD_RESULT with no token yet is told to wait", w.body.ignored, "no public_token yet; left open for recover");
  eq("...and the session stays open", usedOf(db, "lt-1"), false);
  const sf = await call({ webhook_type: "LINK", webhook_code: "SESSION_FINISHED", link_token: "lt-1" }, { db, plaid });
  eq("SESSION_FINISHED with an empty, unexited answer leaves it open too", [sf.body.ignored, usedOf(db, "lt-1")], ["no public_token yet; left open for recover", false]);
  const r1 = await call({ recover: true }, { db, plaid });
  eq("an early recover says not ready (the webhook was evidence)", r1.body, { ok: false, code: "ITEM_NOT_READY" });
  eq("...because ITEM_ADD_RESULT was written down", !!db.tables.plaid_link_sessions[0].item_reported_at, true);
  eq("...and leaves it open (this used to close it for good)", usedOf(db, "lt-1"), false);
  // A minute later the result is there.
  answers["lt-1"] = { link_sessions: [withItem("22:21:10", "pt-late")] };
  const r2 = await call({ recover: true }, { db, plaid });
  eq("the next recover connects", r2.body.ok, true);
  eq("...and the session is closed", usedOf(db, "lt-1"), true);
}

console.log("\n== the user backing out still closes it ==");
{
  const db = makeDb({ plaid_link_sessions: [session("lt-1", "2026-11-03T22:20:00Z")] });
  const plaid = makePlaid({ "lt-1": { link_sessions: [exited("22:20:30")] } });
  const w = await call({ webhook_type: "LINK", webhook_code: "SESSION_FINISHED", link_token: "lt-1" }, { db, plaid });
  eq("SESSION_FINISHED after an exit closes it", [w.body.ignored, usedOf(db, "lt-1")], ["session finished with no item", true]);
  const db2 = makeDb({ plaid_link_sessions: [session("lt-1", "2026-11-03T22:20:00Z")] });
  const r = await call({ recover: true }, { db: db2, plaid });
  eq("...and so does recover", [r.body.code, usedOf(db2, "lt-1")], ["NO_ITEM_IN_SESSION", true]);
}

console.log("\n== the webhook path finds a token in a later entry ==");
{
  const db = makeDb({ plaid_link_sessions: [session("lt-1", "2026-11-03T22:20:00Z")] });
  const plaid = makePlaid({ "lt-1": { link_sessions: [empty("22:20:05"), withItem("22:21:10", "pt-oauth")] } });
  const w = await call({ webhook_type: "LINK", webhook_code: "ITEM_ADD_RESULT", link_token: "lt-1" }, { db, plaid });
  eq("ITEM_ADD_RESULT connects the OAuth bank", w.body.ok, true);
  eq("...one item", db.tables.plaid_items.length, 1);
}

console.log("\n== two at once exchange once ==");
{
  const db = makeDb({ plaid_link_sessions: [session("lt-1", "2026-11-03T22:20:00Z")] });
  const plaid = makePlaid({ "lt-1": { link_sessions: [withItem("22:21:10", "pt-once")] } });
  // The webhook claimed it first; recover arriving after finds nothing open.
  await call({ webhook_type: "LINK", webhook_code: "ITEM_ADD_RESULT", link_token: "lt-1" }, { db, plaid });
  const r = await call({ recover: true }, { db, plaid });
  eq("recover after the webhook finds nothing to do", r.body, { ok: false, code: "NO_OPEN_SESSION" });
  eq("...and the token was exchanged once", plaid.calls.filter((c) => c === "/item/public_token/exchange").length, 1);
}

console.log("\n== a failed exchange gives the session back ==");
{
  const db = makeDb({ plaid_link_sessions: [session("lt-1", "2026-11-03T22:20:00Z")] });
  const plaid = makePlaid({ "lt-1": { link_sessions: [withItem("22:21", "pt-expired")] } });
  const r = await call({ recover: true }, { db, plaid });
  eq("the exchange's own code comes back", r.body, { ok: false, code: "INVALID_PUBLIC_TOKEN" });
  eq("...and the session is open again, nothing stored", [usedOf(db, "lt-1"), (db.tables.plaid_items ?? []).length], [false, 0]);
}

console.log("\n== recover says how long a connection is still finishing ==");
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const completed = (at) => ({ link_session_id: `s-${at}`, started_at: at, finished_at: at, results: { item_add_results: [] } });
{
  // EVIDENCE: Plaid says the session completed; its result is not written yet.
  const db = makeDb({ plaid_link_sessions: [session("lt-1", ago(5))] });
  const plaid = makePlaid({ "lt-1": { link_sessions: [completed("x")] } });
  const r = await call({ recover: true }, { db, plaid });
  const left = (Date.parse(r.body.pending_until) - Date.now()) / 60_000;
  eq("a session Plaid completed, 5 minutes old: finishing, for about 25 more minutes",
    [r.body.code, left > 24 && left <= 25], ["ITEM_NOT_READY", true]);

  const old = makeDb({ plaid_link_sessions: [session("lt-1", ago(31))] });
  const r2 = await call({ recover: true }, { db: old, plaid });
  eq("past 30 minutes it is not (Connect comes back)", [r2.body.code, "pending_until" in r2.body], ["ITEM_NOT_READY", false]);

  const none = makeDb({ plaid_link_sessions: [] });
  const r3 = await call({ recover: true }, { db: none, plaid });
  eq("nothing open, nothing finishing", [r3.body.code, "pending_until" in r3.body], ["NO_OPEN_SESSION", false]);

  const exitedDb = makeDb({ plaid_link_sessions: [session("lt-1", ago(2))] });
  const r4 = await call({ recover: true }, { db: exitedDb, plaid: makePlaid({ "lt-1": { link_sessions: [exited("x")] } }) });
  eq("a session the user backed out of is closed, so it is not finishing either",
    [r4.body.code, "pending_until" in r4.body], ["NO_ITEM_IN_SESSION", false]);
}

console.log("\n== 2026-11-03, sandbox: Plaid never opened. No evidence, no Finishing ==");
{
  // The row is written when the token is minted. Plaid has nothing for it.
  const db = makeDb({ plaid_link_sessions: [session("lt-1", ago(1))] });
  const r = await call({ recover: true }, { db, plaid: makePlaid({ "lt-1": { link_sessions: [] } }) });
  eq("an open session Plaid has nothing for is NOT finishing", [r.body.code, "pending_until" in r.body], ["NO_RESULT", false]);
  eq("...and it stays open, in case it lands after all", usedOf(db, "lt-1"), false);

  const started = makeDb({ plaid_link_sessions: [session("lt-1", ago(1))] });
  const r2 = await call({ recover: true }, { db: started, plaid: makePlaid({ "lt-1": { link_sessions: [empty("x")] } }) });
  eq("...nor is one Plaid opened but nothing finished in", [r2.body.code, "pending_until" in r2.body], ["NO_RESULT", false]);

  // An ITEM_ADD_RESULT that arrived is evidence even with no token yet.
  const reported = makeDb({ plaid_link_sessions: [{ ...session("lt-1", ago(1)), item_reported_at: ago(0) }] });
  const r3 = await call({ recover: true }, { db: reported, plaid: makePlaid({ "lt-1": { link_sessions: [] } }) });
  eq("an ITEM_ADD_RESULT webhook is evidence: finishing", [r3.body.code, "pending_until" in r3.body], ["ITEM_NOT_READY", true]);

  // A public token is evidence even when the exchange fails.
  const failed = makeDb({ plaid_link_sessions: [session("lt-1", ago(1))] });
  const r4 = await call({ recover: true }, { db: failed, plaid: makePlaid({ "lt-1": { link_sessions: [withItem("x", "pt-expired")] } }) });
  eq("a public token whose exchange failed: finishing (recover retries it)",
    [r4.body.code, "pending_until" in r4.body], ["INVALID_PUBLIC_TOKEN", true]);

  // An abandoned session beside one with evidence: the evidence one decides.
  const mixed = makeDb({ plaid_link_sessions: [session("lt-new", ago(1)), session("lt-old", ago(10))] });
  const r5 = await call({ recover: true }, { db: mixed, plaid: makePlaid({ "lt-new": { link_sessions: [] }, "lt-old": { link_sessions: [completed("x")] } }) });
  const left = (Date.parse(r5.body.pending_until) - Date.now()) / 60_000;
  eq("pending_until runs from the session WITH evidence, not the newest", left > 19 && left <= 20, true);

  // A database without the new column still recovers.
  const noColumn = makeDb({ plaid_link_sessions: [session("lt-1", ago(1))] });
  const realFrom = noColumn.from;
  noColumn.from = (name) => {
    const q = realFrom(name);
    const sel = q.select;
    q.select = (cols) => (String(cols).includes("item_reported_at")
      ? { in: async () => ({ data: null, error: { message: "column does not exist" } }) } : sel(cols));
    return q;
  };
  const r6 = await call({ recover: true }, { db: noColumn, plaid: makePlaid({ "lt-1": { link_sessions: [withItem("x", "pt-nocol")] } }) });
  eq("without the item_reported_at column, recover still connects", r6.body.ok, true);
}

console.log("\n== the balance read while connecting is kept (no second pull) ==");
{
  const db = makeDb({
    plaid_link_sessions: [session("lt-1", "2026-11-03T22:20:00Z")],
    budget_entities: [{ user_id: "u-poppy", entity_id: "e-chk", kind: "account", deleted_at: null, data: { id: "checking", kind: "checking" } }],
  });
  const plaid = makePlaid({ "lt-1": { link_sessions: [withItem("22:21", "pt-bal")] } });
  const r = await call({ recover: true, timeZone: "America/New_York" }, { db, plaid });
  eq("recover with the device's zone says it synced", [r.body.ok, r.body.synced], [true, true]);
  eq("...one balance call, the one it needed anyway",
    plaid.calls.filter((c) => c === "/accounts/balance/get").length, 1);
  eq("...written as the first snapshot, available, on the user's own day",
    db.writes.map((w) => [w.p_account_id, w.p_amount, w.p_date.length, w.p_force]), [["checking", 812.4, 10, false]]);
  const item = db.tables.plaid_items[0];
  eq("...and the Item is marked synced, so the open pull that follows finds it fresh",
    [item.status, typeof item.last_synced_at, item.time_zone], ["ok", "string", "America/New_York"]);
  eq("...with the account's numbers kept", [db.tables.plaid_accounts[0].last_available, db.tables.plaid_accounts[0].last_current], [812.4, 830]);

  // A webhook carries no zone: the first balance is left to the client.
  const db2 = makeDb({
    plaid_link_sessions: [session("lt-1", "2026-11-03T22:20:00Z")],
    budget_entities: [{ user_id: "u-poppy", entity_id: "e-chk", kind: "account", deleted_at: null, data: { id: "checking", kind: "checking" } }],
  });
  const w = await call({ webhook_type: "LINK", webhook_code: "ITEM_ADD_RESULT", link_token: "lt-1", timeZone: "Pacific/Auckland" }, { db: db2, plaid });
  eq("a webhook-finished connection writes no snapshot (no zone to date it by)", [w.body.synced, db2.writes.length], [false, 0]);
  eq("...and leaves the Item unsynced, so the client's pull still runs", db2.tables.plaid_items[0].last_synced_at ?? null, null);
}

// ---- plaid-link-token: what holds the Connect slot -------------------
//
// 2026-11-03, sandbox, the owner's phone: Plaid never opened, the
// unused session row reserved the slot for ten minutes, and Connect
// could only answer ALREADY_STARTING. Only a session with evidence
// holds it now. The same fakes, the real handler.
console.log("\n== plaid-link-token: an abandoned session does not hold Connect ==");
const LT_FAKES = FAKES + `
export const PRODUCTS = ["auth"];
export const ACCOUNT_FILTERS = {};
export const betaIsFull = () => false;
export const cooldownUntil = () => null;
`;
const ltOut = await build({
  entryPoints: [new URL("../supabase/functions/plaid-link-token/index.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "neutral", logLevel: "silent",
  plugins: [{
    name: "fakes",
    setup(b) {
      b.onResolve({ filter: /_shared\/(caller|plaid|webhookVerify)\.ts$/ }, () => ({ path: "fakes", namespace: "fakes" }));
      b.onLoad({ filter: /.*/, namespace: "fakes" }, () => ({ contents: LT_FAKES.replace('linkTokenGet: "/link/token/get",', 'linkTokenGet: "/link/token/get", linkTokenCreate: "/link/token/create",'), loader: "js" }));
    },
  }],
});
const exchangeHandler = handler;
const ltFile = new URL("link-token.mjs", cache);
writeFileSync(ltFile, ltOut.outputFiles[0].text);
await import(ltFile.href);
const linkTokenHandler = handler;
handler = exchangeHandler;
async function mint(db, answers) {
  const plaid = makePlaid(answers);
  const base = plaid.fn;
  plaid.fn = async (c, endpoint, body) => (endpoint === "/link/token/create"
    ? { data: { link_token: "lt-new", hosted_link_url: "https://hosted.plaid.com/x", expiration: FUTURE } }
    : base(c, endpoint, body));
  globalThis.__db = db; globalThis.__plaid = plaid.fn; globalThis.__caller = "u-poppy";
  const res = await linkTokenHandler(new Request("https://x/plaid-link-token", { method: "POST", body: JSON.stringify({ hosted: true }) }));
  return (await res.json());
}
{
  const fresh = makeDb({ plaid_link_sessions: [session("lt-1", ago(1))] });
  const r = await mint(fresh, { "lt-1": { link_sessions: [] } });
  eq("a session Plaid never opened does not block a new Connect", [r.ok, r.hosted_link_url], [true, "https://hosted.plaid.com/x"]);
  eq("...and the old one is left open for recover", usedOf(fresh, "lt-1"), false);

  const done = makeDb({ plaid_link_sessions: [session("lt-1", ago(1))] });
  eq("a session Plaid completed still holds it",
    (await mint(done, { "lt-1": { link_sessions: [completed("x")] } })).code, "ALREADY_STARTING");

  const token = makeDb({ plaid_link_sessions: [session("lt-1", ago(1))] });
  eq("...so does one with a public token",
    (await mint(token, { "lt-1": { link_sessions: [withItem("x", "pt")] } })).code, "ALREADY_STARTING");

  const reported = makeDb({ plaid_link_sessions: [{ ...session("lt-1", ago(1)), item_reported_at: ago(0) }] });
  eq("...and one an ITEM_ADD_RESULT webhook announced",
    (await mint(reported, { "lt-1": { link_sessions: [] } })).code, "ALREADY_STARTING");
}

console.log(`\n${failures ? `FAILED ${failures} of ${checks}` : `ALL PASS (${checks} checks)`}`);
process.exit(failures ? 1 : 0);
