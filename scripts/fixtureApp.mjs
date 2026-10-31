// The real app, signed in, holding the fixture account — in a real browser.
//
// This exists because of maintenance rule 5: verify the thing the USER
// touches, starting from the real entry point. Reproducing a UI bug used to
// mean signing into the author's own account, which is slow, destructive and
// impossible to leave in a script. Here the app boots exactly as it does for
// a user — same bundle, same auth gate, same loadState — with a seeded
// session and the Supabase origin intercepted, so a check can click a real
// button and read what actually rendered.
//
// Production code is untouched. There is no screenshot/demo mode that could
// be left switched on by accident; the whole deception lives in this file.
//
// Needs Google Chrome installed (CHROME=/path overrides) and nothing else.
import { todayISO } from "../src/engine/model.ts";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { splitState, ENTITY_SCHEMA_VERSION } from "../src/engine/entities.ts";
import { fixtureState } from "./fixture.mjs";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/**
 * A FREE PORT PER INVOCATION, asked of the operating system.
 *
 * This was a fixed 5181 with `--strictPort`, which is two bugs at
 * once and both of them showed up on 2026-10-21 in the sharded
 * mutation run. Four shards drive the browser at the same time, so
 * three of them bind a port the first one holds; and even one shard
 * alone runs the drive dozens of times in a row, where a vite that
 * has not finished letting go of the port makes the NEXT run attach
 * to the previous server. That run saw four `open` pulls instead of
 * one and then could not find the Balance button — three FAIL lines
 * out of pure flake, which the mutation runner reads as three kills
 * and so hides a survivor.
 *
 * Port 0 is the kernel answering "one that is free", and the listen
 * is closed before vite is told about it. Two processes can still
 * race for the same answer; `--strictPort` means the loser dies
 * loudly rather than quietly sharing, which is the right direction.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    // `listen` IS ASYNC: the port is not on `address()` until the
    // listening event. Reading it straight after the call hands back
    // null every time.
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() ?? {};
      srv.close(() => (port ? resolve(port) : reject(new Error("could not get a free port"))));
    });
  });
}

// Read from .env.local only to know which origin to intercept. Nothing is
// ever sent to it, and no key is read.
function supabaseUrl() {
  const env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  const m = env.match(/^VITE_SUPABASE_URL\s*=\s*(.+)$/m);
  if (!m) throw new Error("VITE_SUPABASE_URL not found in .env.local");
  return m[1].trim().replace(/\/+$/, "");
}

/**
 * Wait until the dev server ANSWERS, by asking it.
 *
 * This used to wait until the port refused a bind, on the theory that
 * "in use" means "server up". Two things wrong with that, and the second
 * cost a session: it is a proxy for the thing we need rather than the
 * thing itself, and it binds 127.0.0.1 while Vite may listen only on
 * ::1 — so the probe kept succeeding, the wait never resolved, and the
 * harness reported "nothing came up" about a server that was serving
 * fine. Fetching the page cannot be wrong about whether the page is
 * being served.
 */
const waitForServer = async (origin, ms = 45_000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(origin, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`${origin} never answered`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

// An unsigned JWT. Nothing verifies it: the only code that reads it is
// auth-js deciding whether the stored session has expired.
function fakeJwt(sub, exp) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, exp, role: "authenticated", aud: "authenticated" })}.x`;
}

/**
 * @param {{width?: number, height?: number, scale?: number, state?: object,
 *          plaid?: {institution?: string, mask?: string, available?: number,
 *                   lastSyncedAt?: string}}} opts
 *
 * `plaid` SERVES A CONNECTED ACCOUNT. Without it nothing about
 * connected checking is reachable in a drive, and the one class of
 * bug this feature keeps producing — the server wrote it and the
 * page did not notice — is invisible to every other kind of test.
 * It has happened three times: the pill holding a second copy of
 * the connection, the "another device" banner, and a
 * `reloadFromServer` captured before sign-in that made "Use bank
 * balance" a no-op for as long as it existed. All three were found
 * by a person using the app.
 *
 * The balance function here is NOT a stub of the client's call: it
 * is a stand-in for the SERVER, and it writes to the same `rows`
 * the page loads from, exactly as the edge function writes to
 * budget_entities. So a page that fails to re-read fails this
 * drive, which is the whole point.
 */
export async function openFixtureApp({ width = 1100, height = 1000, scale = 2, state, plaid } = {}) {
  const SUPABASE = supabaseUrl();
  const ref = new URL(SUPABASE).hostname.split(".")[0];
  const userId = "00000000-0000-4000-8000-000000000001";
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const session = {
    access_token: fakeJwt(userId, expires),
    refresh_token: "fixture",
    token_type: "bearer",
    expires_in: 60 * 60 * 24 * 365,
    expires_at: expires,
    user: {
      id: userId, aud: "authenticated", role: "authenticated",
      email: "sam@example.com", app_metadata: { providers: ["email"] },
      user_metadata: {}, created_at: new Date().toISOString(),
    },
  };

  const now = new Date().toISOString();
  // THE LOCAL DAY, as the page computes it — never the UTC slice of
  // `now`. After 8 PM Eastern those disagree, the stand-in looked for
  // tomorrow's snapshot row, wrote nothing and still answered
  // "written", and drive_connected failed every evening (found
  // 2026-10-30 at 10:17 PM). The calendar's Greenwich bug, in the
  // harness this time.
  const today = todayISO();
  let syncedAt = plaid?.lastSyncedAt ?? now;
  /** Every trigger the page asked for, in order, for the drive to read. */
  const calls = [];
  const rows = splitState(state ?? fixtureState()).map((e) => ({
    kind: e.kind, entity_id: e.id, data: e.data,
    version: 1, schema_version: ENTITY_SCHEMA_VERSION, updated_at: now,
  }));

  // DETACHED, so it can be killed as a GROUP. `vite.kill()` signals
  // npx, which does not pass it on — so every drive used to leak a
  // dev server still holding its port, and a hundred mutations leaked
  // a hundred of them. That is the other half of the flake above.
  const PORT = await freePort();
  const ORIGIN = `http://localhost:${PORT}`;
  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true });
  const stopVite = () => { try { process.kill(-vite.pid, "SIGKILL"); } catch { /* already gone */ } };
  // AND ON THE WAY OUT, because a drive that throws never reaches
  // close() — which is exactly when a leak is least likely to be
  // noticed and most likely to break the next run.
  process.once("exit", stopVite);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
  await waitForServer(ORIGIN);
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith(SUPABASE)) return req.continue();
    const cors = {
      "access-control-allow-origin": ORIGIN,
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
      "access-control-allow-credentials": "true",
    };
    if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: cors });
    const send = (b) => req.respond({
      status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(b),
    });

    if (plaid) {
      if (url.includes("/plaid_beta")) return send([{ user_id: userId }]);
      if (url.includes("/plaid_items")) return send([{
        institution_name: plaid.institution ?? "First Platypus Bank",
        status: "ok", last_synced_at: syncedAt,
      }]);
      if (url.includes("/plaid_accounts")) return send([{ mask: plaid.mask ?? "0000" }]);
      if (url.includes("/functions/v1/plaid-balance")) {
        const trigger = JSON.parse(req.postData() || "{}").trigger ?? "open";
        calls.push(trigger);
        // OPTIONAL, AND READ ON EVERY CALL so a drive can change them
        // between phases: `nextPullIn` is the server's "ask again in"
        // (absent, the client asks every time, as with an old server),
        // and `fresh` answers the way plaid-balance does inside its
        // 12-hour window — no pull, no write.
        const next = plaid.nextPullIn == null ? {} : { next_pull_in_seconds: plaid.nextPullIn };
        if (plaid.fresh && trigger === "open") {
          return send({ connected: true, status: "ok", synced: false, reason: "fresh", last_synced_at: syncedAt, ...next });
        }
        // IT WRITES INTO THE ROWS THE PAGE RELOADS FROM, exactly as
        // the edge function writes to budget_entities — so a page
        // that fails to re-read shows the old number and fails here.
        //
        // AND IT KEEPS THE COLLISION RULE. A stand-in that always
        // wrote would overwrite the user's own figure on the
        // pull-on-open, and the drive would be set up in a state the
        // real server never produces. `adopt` forces; the other two
        // decline a date the user typed, which is the rule
        // plaid_write_balance enforces in SQL.
        const dated = rows.find((r) => r.kind === "accountSnapshot" && r.entity_id.endsWith(today));
        const theirs = (dated?.data?.source ?? "manual") === "manual";
        syncedAt = new Date().toISOString();
        if (dated && theirs && trigger !== "adopt") {
          return send({ connected: true, status: "ok", synced: true, applied: "kept_manual", last_synced_at: syncedAt, ...next });
        }
        if (dated) {
          dated.data = { ...dated.data, amount: plaid.available ?? 956.79, source: "plaid", externalId: "fix" };
          dated.version += 1;
        }
        return send({ connected: true, status: "ok", synced: true, applied: "written", last_synced_at: syncedAt, ...next });
      }
    }

    // loadState asks for the entity columns; fetchVersion asks only for
    // updated_at. Everything else (account_deletions, auth) is empty.
    const body = url.includes("budget_entities")
      ? (url.includes("kind%2Centity_id") || url.includes("kind,entity_id") ? rows : [{ updated_at: now }])
      : [];
    send(body);
  });

  await page.evaluateOnNewDocument(
    (key, value, theme) => {
      localStorage.setItem(key, value);
      localStorage.setItem("budget-app-theme", theme);
    },
    `sb-${ref}-auth-token`, JSON.stringify(session), "light"
  );

  return {
    page,
    /** The plaid-balance triggers the page sent, in order. */
    calls,
    async load(tab) {
      await page.goto(`${ORIGIN}/app`, { waitUntil: "networkidle0" });
      await page.waitForSelector("main", { timeout: 20_000 });
      if (tab) await this.goToTab(tab);
    },
    // Click the tab by its own label rather than by position: the tab ORDER
    // is user data and a fixture could reorder it tomorrow.
    async goToTab(tab) {
      await page.evaluate((t) => {
        const btn = [...document.querySelectorAll("nav button")].find((b) => b.textContent.trim() === t);
        if (!btn) throw new Error(`no ${t} tab`);
        btn.click();
      }, tab);
      await new Promise((r) => setTimeout(r, 1200)); // Recharts animates in
    },
    async close() {
      await browser.close();
      stopVite();
    },
  };
}
