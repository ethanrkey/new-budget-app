// Sign out, in a real browser, watching what goes over the wire.
//
//   node scripts/drive_signout.mjs
//
// THE BUG THIS GUARDS, found in the Supabase auth log on 2026-10-17:
// "400: Invalid Refresh Token: Refresh Token Not Found". Signing out
// used the auth-js default scope, which is GLOBAL — every session the
// user has, on every device. So signing out on the phone revoked the
// browser's refresh token, and the browser found out up to an hour
// later on its next refresh. That is the whole of "the web signs me
// out every so often and iOS doesn't", which had collected three
// wrong suspects over two batches.
//
// Asserting on the REQUEST and not on the call, because the scope is
// a query parameter on /auth/v1/logout and the argument that produces
// it is the thing that was missing. A test of the argument would have
// been written against the same misunderstanding.
import { openFixtureApp, ORIGIN } from "./fixtureApp.mjs";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, c) => eq(label, !!c, true);
void ORIGIN;

const app = await openFixtureApp({ width: 1100, height: 1000 });
const seen = [];
try {
  // Recording only. fixtureApp's own handler is the one that responds;
  // a second responder would throw.
  app.page.on("request", (req) => {
    // The CORS preflight rides along on the same URL, so the method
    // has to be part of what is recorded or "exactly once" counts two.
    if (/\/auth\/v1\//.test(req.url())) seen.push({ method: req.method(), url: req.url() });
  });

  await app.load();
  await app.page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "⚙ Settings");
    if (!b) throw new Error("no Settings button");
    b.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  // TWO rows say "Manage" — categories and the account. Pick the one
  // in the row that says Account, rather than the first.
  await app.page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .filter((x) => x.textContent.trim() === "Manage")
      .find((x) => /Account/.test(x.parentElement.textContent));
    if (!b) throw new Error("no Account > Manage — has Settings been rearranged?");
    b.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  await app.page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Sign out");
    if (!b) throw new Error("no Sign out button");
    b.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  const logouts = seen.filter((r) => r.url.includes("/auth/v1/logout") && r.method === "POST");
  eq("pressing Sign out calls logout exactly once", logouts.length, 1);
  is("...scoped to THIS device", /[?&]scope=local\b/.test(logouts[0]?.url ?? ""));
  is("...and never globally", !/[?&]scope=global\b/.test(logouts[0]?.url ?? ""));
} finally {
  await app.close();
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
