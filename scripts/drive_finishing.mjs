// "Finishing your connection…" on the web, in a real browser.
//
//   node scripts/drive_finishing.mjs
//
// 2026-11-03: Capital One finished at Plaid, Settings said "Connect your
// bank" over the unfinished session, and the tester tapped it twice
// more. While recover says a session is open and young, Settings →
// Account now says it is finishing, keeps asking, and draws no Connect.
//
// The phone's half is mobile/__tests__/connected.test.tsx.
// Not in `npm test`: it starts Vite and Chrome.
import { openFixtureApp } from "./fixtureApp.mjs";
import { fixtureState } from "./fixture.mjs";

let failures = 0, checks = 0;
function eq(label, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FINISHING = "Finishing your connection…";
const CONNECT = "Connect your bank (Beta)";

const base = fixtureState();
const state = { ...base, settings: { ...base.settings, connectedFeatures: true, hideConnectHint: true } };
const soon = () => new Date(Date.now() + 20 * 60_000).toISOString();
const plaid = { noItem: true, recover: { ok: false, code: "ITEM_NOT_READY", pending_until: soon() } };

async function openAccount(page) {
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "⚙ Settings").click());
  await wait(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .filter((x) => x.textContent.trim() === "Manage")
      .find((x) => /Account/.test(x.parentElement.textContent));
    b.click();
  });
  await wait(800);
}
const seen = (page) => page.evaluate((F, C) => {
  const modal = [...document.querySelectorAll("[data-modal]")].pop();
  const text = modal?.innerText ?? "";
  return {
    finishing: text.includes(F),
    connect: [...(modal?.querySelectorAll("button") ?? [])].some((b) => b.textContent.trim() === C),
    bank: text.includes("First Platypus Bank"),
  };
}, FINISHING, CONNECT);

const app = await openFixtureApp({ state, plaid });
try {
  await app.load();
  await openAccount(app.page);
  const first = await seen(app.page);
  eq("an unfinished session shows Finishing your connection…", first.finishing, true);
  eq("...and no Connect button to start a second Link", first.connect, false);
  eq("...and says not to connect again",
    await app.page.evaluate(() => document.body.innerText.includes("You don't need to connect again.")), true);

  // The tab coming back is the web's foreground: it asks again.
  const before = app.recovers.n;
  plaid.recover = { ok: true, connected: true, institution_name: "First Platypus Bank", synced: true };
  plaid.noItem = false;
  await app.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await wait(1500);
  const landed = await seen(app.page);
  eq("a tab coming back asks again", app.recovers.n > before, true);
  eq("...and shows the bank once it is saved", [landed.bank, landed.finishing, landed.connect], [true, false, false]);
} finally {
  await app.close();
}

// Run out: back to Connect.
{
  const gone = { noItem: true, recover: { ok: false, code: "ITEM_NOT_READY", pending_until: new Date(Date.now() - 1000).toISOString() } };
  const app2 = await openFixtureApp({ state, plaid: gone });
  try {
    await app2.load();
    await openAccount(app2.page);
    const s = await seen(app2.page);
    eq("once the session has run out, Connect is back", [s.connect, s.finishing], [true, false]);
  } finally {
    await app2.close();
  }
}

// A SAVE THAT FAILS AFTER PLAID FINISHED (web). While the session is
// still finishing, the message must not say "try again": that is a
// second Link and a second slot. Once it has run out, it may.
const SLOW = "saving it is taking longer than usual";
async function connectAndFail(page) {
  // Link itself is stubbed: it "finishes" at once with a public token.
  await page.evaluate(() => {
    window.Plaid = { create: (o) => ({ open: () => setTimeout(() => o.onSuccess("public-fixture"), 50) }) };
  });
  await page.evaluate((C) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === C).click(), CONNECT);
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue").click());
  await wait(1500);
  return page.evaluate(() => document.body.innerText);
}
for (const [label, recover, want] of [
  ["still finishing", { ok: false, code: "ITEM_NOT_READY", pending_until: soon() }, { slow: true, tryAgain: false, finishing: true, connect: false }],
  ["run out", { ok: false, code: "NO_OPEN_SESSION" }, { slow: false, tryAgain: true, finishing: false, connect: true }],
]) {
  const p = { noItem: true, recover: { ok: false, code: "NO_OPEN_SESSION" }, exchange: { ok: false, code: "EXCHANGE_FAILED" } };
  const a = await openFixtureApp({ state, plaid: p });
  try {
    await a.load();
    await openAccount(a.page);
    p.recover = recover;
    const text = await connectAndFail(a.page);
    const s = await seen(a.page);
    eq(`a failed save, ${label}: slow / try again / Finishing / Connect`,
      { slow: text.includes(SLOW), tryAgain: text.includes("try again"), finishing: s.finishing, connect: s.connect }, want);
  } finally {
    await a.close();
  }
}

console.log(`\n${failures ? `FAILED ${failures} of ${checks}` : `ALL PASS (${checks} checks)`}`);
process.exit(failures ? 1 : 0);
