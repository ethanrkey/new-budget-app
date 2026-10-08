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
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { splitState, ENTITY_SCHEMA_VERSION } from "../src/engine/entities.ts";
import { fixtureState } from "./fixture.mjs";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.PORT || 5181);
export const ORIGIN = `http://localhost:${PORT}`;

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

/** @param {{width?: number, height?: number, scale?: number, state?: object}} opts */
export async function openFixtureApp({ width = 1100, height = 1000, scale = 2, state } = {}) {
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
  const rows = splitState(state ?? fixtureState()).map((e) => ({
    kind: e.kind, entity_id: e.id, data: e.data,
    version: 1, schema_version: ENTITY_SCHEMA_VERSION, updated_at: now,
  }));

  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
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
    // loadState asks for the entity columns; fetchVersion asks only for
    // updated_at. Everything else (account_deletions, auth) is empty.
    const body = url.includes("budget_entities")
      ? (url.includes("kind%2Centity_id") || url.includes("kind,entity_id") ? rows : [{ updated_at: now }])
      : [];
    req.respond({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
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
      vite.kill();
    },
  };
}
