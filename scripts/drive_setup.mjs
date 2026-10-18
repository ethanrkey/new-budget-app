// The web's setup wizard, its tour and the Planned spending caption,
// driven in a real browser.
//
//   node scripts/drive_setup.mjs
//
// Maintenance rule 5: verify the thing the USER touches, from the real
// entry point. The phone's versions of all three are covered by the
// renderer harness in mobile/__tests__; the web has none, so without
// this the web half of a shared-copy change is unverified.
//
// Not in `npm test`: it starts Vite and Chrome.
import { openFixtureApp } from "./fixtureApp.mjs";
import { fixtureState } from "./fixture.mjs";
import { SETUP_COPY } from "../src/content/setup.ts";
import { SPENDING_COPY } from "../src/content/spending.ts";
import { TOUR_STOPS } from "../src/content/tour.ts";

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

/** A brand-new account: the wizard's own gate is this one flag. */
function freshState() {
  const s = fixtureState();
  return {
    ...s,
    settings: { ...s.settings, hasSeenOnboarding: false, hasSeenTour: false },
    recurring: [], oneoffs: [], trackerCategories: [],
    balanceSnapshots: {}, contributionLog: {}, monthlyActuals: {}, overrides: {},
  };
}

const app = await openFixtureApp({ width: 900, height: 1000, state: freshState() });
const page = app.page;
const text = () => page.evaluate(() => document.body.innerText);
const click = (label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === l);
  if (!b) throw new Error(`no button "${l}"`);
  b.click();
}, label);
const type = (selector, value) => page.evaluate((sel, v) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`no ${sel}`);
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set;
  setter.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, selector, value);
const settle = () => new Promise((r) => setTimeout(r, 250));

try {
  await app.load();
  await page.waitForFunction(
    () => /balance of your primary checking account/.test(document.body.innerText),
    { timeout: 20_000 },
  );
  // THE BALANCE FIRST, since 2026-10-17 — the one answer the forecast
  // cannot be built without, and the one question everybody can
  // answer. It was the fifth of six.
  is("a brand-new account is met with the balance question",
    /balance of your primary checking account/.test(await text()));
  await type('input[type="number"]', "4000");
  await click("Continue");
  await settle();

  // ---- income, so the contributions step has a payday to offer -----
  const income = await text();
  is("the second question asks for income, not for a paycheck",
    income.includes(SETUP_COPY.paycheck.title));
  is("...and says that having none is a normal answer",
    income.includes(SETUP_COPY.paycheck.sub));
  // The name arrives filled in, and is a field at all for everyone
  // whose money is not a paycheck.
  eq("income arrives named, so most people answer nothing here",
    await page.$eval("#setup-income-name", (el) => el.value), "Paycheck");
  await type("#setup-income-name", "Disability");
  await type('input[type="number"]', "2100");
  await click("Continue");
  await settle();
  await click("Skip");   // rent
  await settle();

  // ---- the bills step: the new intro and the varies box -------------
  const bills = await text();
  is("the bills step's intro names what the box is for",
    bills.includes(SETUP_COPY.bills.sub));
  not("...and no longer promises every bill is roughly the same",
    /roughly the same amount every month/.test(bills));
  is("every bill row offers 'This bill varies'", bills.includes(SETUP_COPY.bills.varies));

  const variesBox = () => page.$('input[aria-label="Bill 1 varies"]');
  is("the box exists", !!(await variesBox()));
  eq("...and is UNticked by default",
    await page.$eval('input[aria-label="Bill 1 varies"]', (el) => el.checked), false);
  await page.click('input[aria-label="Bill 1 varies"]');
  eq("...and ticks", await page.$eval('input[aria-label="Bill 1 varies"]', (el) => el.checked), true);

  await click("Skip");   // bills — nothing typed into them
  await settle();
  await click("Skip");   // groceries
  await settle();

  // ---- the accounts step's new title -------------------------------
  const accounts = await text();
  is("the accounts step names the three things it is asking about",
    accounts.includes(SETUP_COPY.accounts.title));
  is("...and the section is still called Debt", /\bDebt\b/.test(accounts));

  // One savings account, so there is something to contribute to.
  await page.$eval('input[placeholder="e.g. Emergency fund"]', (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, "Rainy day");
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("input[placeholder]")].find((i) => i.placeholder === "e.g. Emergency fund");
    const amount = row.closest("div").parentElement.querySelector('input[type="number"]');
    const setter = Object.getOwnPropertyDescriptor(amount.constructor.prototype, "value").set;
    setter.call(amount, "2500");
    amount.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  await click("Continue");
  await settle();

  // ---- the contributions step: the opt-in ---------------------------
  const contrib = await text();
  is("the contributions step offers 'On my payday'",
    contrib.includes(SETUP_COPY.contributions.onPayday));
  const box = 'input[aria-label="Rainy day on my payday"]';
  eq("...off by default", await page.$eval(box, (el) => el.checked), false);
  is("...with its own two controls on screen", /First contribution/.test(contrib));

  await page.click(box);
  await settle();
  const ticked = await text();
  eq("ticked, it stays ticked", await page.$eval(box, (el) => el.checked), true);
  not("...and the two questions it answers are gone", /First contribution/.test(ticked));
  not("...including the cadence", /How often\?/.test(ticked));

  // ---- out of the wizard, into the tour -----------------------------
  await click("Finish");
  await settle();
  await click("Go to my budget");
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t), { timeout: 15_000 }, TOUR_STOPS[0].title,
  );
  const tour = await text();
  is("the tour starts after the first setup", tour.includes(TOUR_STOPS[0].title));
  is("...and the Ledger stop carries the owner's new sentence",
    tour.includes("The forecast is only as accurate as what's in it."));
} finally {
  await app.close();
}

// ---- the caption, on an account that has something in it ------------
const lived = await openFixtureApp({ width: 900, height: 1000 });
try {
  await lived.load("ledger");
  await lived.page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /PLANNED SPENDING/i.test(x.textContent));
    if (b && !/rotate-180/.test(b.innerHTML)) b.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const body = await lived.page.evaluate(() => document.body.innerText);
  is("the Planned spending caption is the owner's one sentence",
    /Projected spending based on the transactions you've entered from .+ – .+\./.test(body));
  not("...and the three-claim version is gone", /not what you've logged/.test(body));
  not("...including the income line", /Income is excluded/.test(body));
  // The Ledger's own date column went back to "Oct 18".
  is("the Ledger's date column is a short month and day",
    /\n(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\t/.test(body)
    || /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}/.test(body));
} finally {
  await lived.close();
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
