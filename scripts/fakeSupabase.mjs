// A Supabase stand-in for verifying the PHONE against, on the simulator.
//
//   node scripts/fakeSupabase.mjs          # :5199, fixture data
//
// The web has `fixtureApp.mjs`, which intercepts requests inside a headless
// browser. The phone has no interceptor to hook, so the substitution moves
// one layer out: the app is pointed at this server with
// EXPO_PUBLIC_SUPABASE_URL and is otherwise completely unmodified — real
// sign-in, real `lib/store.ts`, real `planWrite`, real optimistic commit.
//
// Two reasons this exists rather than a stubbed provider:
//
//   1. A stubbed provider is the exact mistake being guarded against. The
//      Ledger's occurrence-date bug shipped because a form was verified
//      standalone while the wiring between it and the mutators never was.
//      Replacing the store replaces the wiring.
//   2. It makes the WRITE assertable. Every request is logged, so "what
//      did the handler actually send" is answered by reading the row that
//      left the device, not by trusting a callback argument.
//
// It is deliberately dumb: no RLS, no auth checks, no concurrency. It is a
// recording surface, not a database.
import { createServer } from "node:http";
import { splitState } from "../src/engine/entities.ts";
import { fixtureState } from "./fixture.mjs";

const PORT = Number(process.env.PORT || 5199);
const USER = "00000000-0000-4000-8000-000000000001";
const EMAIL = "sam@example.com";
const JWT = (() => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 86400 * 365;
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER, exp, role: "authenticated", aud: "authenticated" })}.x`;
})();

const rows = new Map(); // "kind:id" -> row
let nowISO = () => new Date().toISOString();

function seed() {
  rows.clear();
  for (const e of splitState(fixtureState())) {
    rows.set(`${e.kind}:${e.id}`, {
      user_id: USER, kind: e.kind, entity_id: e.id, data: e.data,
      version: 1, schema_version: e.schemaVersion, deleted_at: null, updated_at: nowISO(),
    });
  }
}

const log = [];
const send = (res, code, body) => {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "*",
    "access-control-expose-headers": "*",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

// PostgREST filters arrive as ?kind=eq.recurring&entity_id=eq.r-rent
const eqFilters = (url) => {
  const out = {};
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    if (typeof v === "string" && v.startsWith("eq.")) out[k] = v.slice(3);
    else if (v === "is.null") out[k] = null;
    else if (v === "not.is.null") out[k] = "__NOT_NULL__";
  }
  return out;
};
const matches = (row, f) =>
  Object.entries(f).every(([k, v]) =>
    v === "__NOT_NULL__" ? row[k] != null : v === null ? row[k] == null : String(row[k]) === String(v));

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "OPTIONS") return send(res, 204);

  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const json = body ? JSON.parse(body) : null;
    const path = url.pathname;

    // ---- auth: accept anything, this is not a security test ----------
    if (path.startsWith("/auth/v1/token") || path.startsWith("/auth/v1/signup")) {
      return send(res, 200, {
        access_token: JWT, refresh_token: "fake", token_type: "bearer",
        expires_in: 86400 * 365, expires_at: Math.floor(Date.now() / 1000) + 86400 * 365,
        user: { id: USER, aud: "authenticated", role: "authenticated", email: EMAIL,
                app_metadata: { providers: ["email"] }, user_metadata: {}, created_at: nowISO() },
      });
    }
    if (path.startsWith("/auth/v1/user")) {
      return send(res, 200, { id: USER, aud: "authenticated", role: "authenticated", email: EMAIL,
                              app_metadata: { providers: ["email"] }, user_metadata: {}, created_at: nowISO() });
    }
    if (path.startsWith("/auth/v1/logout")) return send(res, 204);

    // ---- the table ----------------------------------------------------
    if (path === "/rest/v1/budget_entities") {
      const f = eqFilters(url);
      if (req.method === "GET") {
        return send(res, 200, [...rows.values()].filter((r) => matches(r, f)));
      }
      if (req.method === "POST") {
        const key = `${json.kind}:${json.entity_id}`;
        const existing = rows.get(key);
        if (existing && existing.deleted_at == null) {
          log.push({ op: "insert-conflict", key });
          return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
        }
        if (existing) {
          log.push({ op: "insert-conflict-tombstoned", key });
          return send(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
        }
        const row = { user_id: USER, ...json, version: 1, deleted_at: null, updated_at: nowISO() };
        rows.set(key, row);
        log.push({ op: "insert", key, data: json.data });
        return send(res, 201, [{ version: row.version, updated_at: row.updated_at }]);
      }
      if (req.method === "PATCH") {
        const hits = [...rows.values()].filter((r) => matches(r, f));
        if (hits.length === 0) { log.push({ op: "patch-miss", filters: f }); return send(res, 200, []); }
        const out = hits.map((r) => {
          Object.assign(r, json, { version: r.version + 1, updated_at: nowISO() });
          log.push({
            op: json.deleted_at ? "tombstone" : r.deleted_at === null && json.deleted_at === null ? "revive-or-update" : "update",
            key: `${r.kind}:${r.entity_id}`, data: json.data,
          });
          return { version: r.version, updated_at: r.updated_at };
        });
        return send(res, 200, out);
      }
    }
    if (path === "/rest/v1/account_deletions") return send(res, 200, []);
    if (path.startsWith("/rest/v1/rpc/")) return send(res, 200, null);

    // ---- the harness's own endpoints -----------------------------------
    if (path === "/__log") return send(res, 200, log);
    if (path === "/__rows") return send(res, 200, [...rows.values()]);
    if (path === "/__reset") { seed(); log.length = 0; return send(res, 200, { ok: true }); }

    send(res, 404, { message: `no route for ${req.method} ${path}` });
  });
}).listen(PORT, () => {
  seed();
  console.log(`fake supabase on http://localhost:${PORT}  (${rows.size} rows)`);
  console.log(`sign in as ${EMAIL} with any password`);
});
