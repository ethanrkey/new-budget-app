// The Checking bar with a bank behind it, in a real browser.
//
//   node scripts/drive_connected.mjs
//
// WHY THIS EXISTS. Connected checking has produced the same bug
// three times, and all three times a person using the app found it,
// not a test: THE SERVER WROTE IT AND THE PAGE DID NOT NOTICE.
//
//   - the pill kept a second copy of the connection and went on
//     saying "as of" after connecting (2026-10-20);
//   - the focus check announced our own write as another device's
//     (2026-10-21);
//   - and under that one, "Use bank balance" had NEVER re-read
//     anything: `pullNow` is a useCallback with `[]` and it captured
//     a `reloadFromServer` built before sign-in, which returns at
//     its own first line. The focus check was quietly doing the
//     reload, so fixing the banner removed the only thing that was
//     working (2026-10-21, in production, on a real bank).
//
// None of that is reachable from a unit test: it is React closure
// identity, a real document load, and a button. So this drives the
// real bundle against the real Supabase client, with the server
// stood in for by scripts/fixtureApp.mjs — which writes into the
// same rows the page loads from, exactly as the edge function
// writes to budget_entities. A page that fails to re-read fails
// here.
import { openFixtureApp } from "./fixtureApp.mjs";
import { fixtureState } from "./fixture.mjs";
import { todayISO } from "../src/engine/model.ts";

let failures = 0, checks = 0;
function eq(label, got, want) {
  checks++;
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
}
const is = (label, c) => eq(label, !!c, true);

/** A fixture account that connected a bank and typed today's balance. */
function connectedState() {
  const base = fixtureState();
  const id = base.accounts[0].id;
  const today = todayISO();
  return {
    ...base,
    settings: { ...base.settings, connectedFeatures: true, hideConnectHint: true },
    accounts: [{ ...base.accounts[0], balance: 956, balanceAsOf: today }],
    accountSnapshots: {
      ...base.accountSnapshots,
      [id]: [
        ...base.accountSnapshots[id],
        { id: "as-today", date: today, amount: 956, source: "manual", loggedAt: new Date().toISOString() },
      ],
    },
  };
}

/** The Checking bar's own text, found by the control that is in it. */
const strip = (page) => page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Balance ▾");
  return btn?.closest("div")?.parentElement?.textContent ?? "";
});

const clickByText = (page, text) => page.evaluate((t) => {
  const el = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
  if (!el) throw new Error(`no "${t}" button — saw: ${[...document.querySelectorAll("button")].map((b) => b.textContent.trim()).join(" | ")}`);
  el.click();
}, text);

const app = await openFixtureApp({ state: connectedState(), plaid: { available: 956.79, mask: "2403" } });
try {
  await app.load();

  console.log("== a manual log today wins the bar, even with a bank behind it ==");
  const before = await strip(app.page);
  is("the bar shows the number the user typed", before.includes("$956.00"));
  is("...and says they logged it, not that it synced", /logged /.test(before));
  is("...so the bar is not claiming a sync it did not apply", !/synced /.test(before));

  console.log("\n== Use bank balance, and the page notices WITHOUT a refresh ==");
  await clickByText(app.page, "Balance ▾");
  await clickByText(app.page, "Use bank balance");
  // Long enough for the call and the reload, and no longer: the
  // point of the check is that a human would have seen it change.
  await new Promise((r) => setTimeout(r, 2500));

  const after = await strip(app.page);
  // "open" on load — the client always asks and lets the server
  // decide — then the one the user chose. Nothing else.
  eq("one pull on open, then the free one the user asked for", app.calls.join(","), "open,adopt");
  is("THE BUG: the bar shows the bank's figure with no page reload", after.includes("$956.79"));
  is("...and now says synced rather than logged", /synced /.test(after) && !/logged /.test(after));
  is("...and the old number is gone", !after.includes("$956.00"));

  console.log("\n== and the offer goes away once there is nothing to drop ==");
  await clickByText(app.page, "Balance ▾");
  const menu = await app.page.evaluate(() =>
    [...document.querySelectorAll("[role=menuitem]")].map((b) => b.textContent.trim()));
  is("Refresh now is still there", menu.includes("Refresh now"));
  is("Log manually is still there", menu.includes("Log manually"));
  is("Use bank balance is not, because it would do nothing", !menu.includes("Use bank balance"));
} finally {
  await app.close();
}

// ---- a tab coming back, with the server saying when to ask --------
//
// 2026-10-30: every focus asked plaid-balance and the bar flashed
// "syncing…" each time, over a balance that was fresh throughout. The
// server now answers with next_pull_in_seconds; the tab does not ask
// again until that has passed.
console.log("\n== a tab switched to five times does not ask five times ==");
{
  const plaid = { available: 956.79, mask: "2403", nextPullIn: 12 * 3600, fresh: true };
  const app2 = await openFixtureApp({ state: connectedState(), plaid });
  try {
    await app2.load();
    eq("the page load asks once", app2.calls.join(","), "open");
    // Watch the bar for "syncing" from here on, so a flash shorter than
    // any poll still counts.
    await app2.page.evaluate(() => {
      window.__sawSyncing = false;
      new MutationObserver(() => {
        if (document.body.textContent.includes("syncing")) window.__sawSyncing = true;
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const comeBack = () => app2.page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    for (let i = 0; i < 5; i++) { await comeBack(); await new Promise((r) => setTimeout(r, 150)); }
    await new Promise((r) => setTimeout(r, 600));
    eq("...and five returns inside the window ask nothing", app2.calls.join(","), "open");
    eq("...and the bar never said syncing", await app2.page.evaluate(() => window.__sawSyncing), false);

    // The window passes. Nothing about the page changes but the
    // server's answer; the next return asks.
    plaid.nextPullIn = 0;
    await clickByText(app2.page, "Balance ▾");
    await clickByText(app2.page, "Refresh now");
    await new Promise((r) => setTimeout(r, 1200));
    await comeBack();
    await new Promise((r) => setTimeout(r, 1200));
    eq("once the server says it is due, a return asks again", app2.calls.join(","), "open,refresh,open");
  } finally {
    await app2.close();
  }
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S) of ${checks}`);
process.exit(failures === 0 ? 0 : 1);
