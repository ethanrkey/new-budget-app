// Opening an existing item for editing, driven in a real browser.
//
//   node scripts/drive_edit.mjs
//
// PRODUCTION, 2026-10-26 to 10-28: clicking an existing one-off in the
// Ledger, or any row in the Budget, blanked the whole app — EventForm
// threw on render and nothing caught it. tests/web-forms.test.mjs
// renders the form; this clicks the rows a user clicks, from the real
// entry point, and asks the two questions that matter: did the form
// open, and is the app still there.
//
// Not in `npm test`: it starts Vite and Chrome. Run it when the event
// form, the Ledger's rows or the Budget's rows change.
import { openFixtureApp } from "./fixtureApp.mjs";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, c) => eq(label, !!c, true);

const app = await openFixtureApp({ width: 1100, height: 1100 });
const thrown = [];
app.page.on("pageerror", (e) => thrown.push(e.message));

// Click the Edit button whose label is `name`, then report what is on
// screen: the form (by an input holding the item's name), the app shell,
// and the boundary's fallback if it fired.
async function openRow(name) {
  await app.page.evaluate((n) => {
    const btn = [...document.querySelectorAll('button[title="Edit"]')].find((b) => b.textContent.trim() === n);
    if (!btn) throw new Error(`no Edit button for ${n}`);
    btn.click();
  }, name);
  await new Promise((r) => setTimeout(r, 400));
  return app.page.evaluate((n) => ({
    formOpen: [...document.querySelectorAll("input")].some((i) => i.value === n),
    amount: [...document.querySelectorAll('input[type="number"]')].map((i) => i.value),
    shell: !!document.querySelector("main") && !!document.querySelector("nav"),
    fallback: document.body.innerText.includes("Something went wrong"),
  }), name);
}
async function cancel() {
  await app.page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel")?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
}

try {
  await app.load("ledger");

  // A one-off: the report's path. "Dentist" is fixture.mjs's o-dent.
  const one = await openRow("Dentist");
  is("an existing one-off opens the form", one.formOpen);
  eq("...with its amount", one.amount.includes("180"), true);
  is("...and the app is still there behind it", one.shell);
  eq("...with no fallback, because nothing threw", one.fallback, false);
  await cancel();

  // A rule, from the Budget: the other path that crashed.
  await app.goToTab("budget");
  const rule = await openRow("Rent");
  is("a Budget row opens the form", rule.formOpen);
  eq("...with its amount", rule.amount.includes("1450"), true);
  is("...and the app is still there behind it", rule.shell);
  eq("...with no fallback", rule.fallback, false);
  await cancel();

  eq("nothing threw anywhere on the page", thrown, []);

  // THE BOUNDARY ITSELF, which nothing above can reach: with the fix in
  // place the form never throws. So make it throw, the way it did in
  // production — `.trim()` failing during EventForm's render — for the
  // length of ONE click, then put trim back. No app code is touched.
  await app.goToTab("ledger");
  // UNTIL THE RENDER HAS RUN, not until the click returns: React 18
  // flushes a click's update in a microtask after the handler, so
  // restoring in a `finally` put trim back before the form ever drew.
  await app.page.evaluate(() => new Promise((done) => {
    const real = String.prototype.trim;
    String.prototype.trim = function () { throw new TypeError("trim is broken for this click"); };
    [...document.querySelectorAll('button[title="Edit"]')].find((b) => real.call(b.textContent) === "Dentist").click();
    setTimeout(() => { String.prototype.trim = real; done(); }, 50);
  }));
  await new Promise((r) => setTimeout(r, 400));
  const caught = await app.page.evaluate(() => ({
    fallback: document.body.innerText.includes("Something went wrong opening this."),
    shell: !!document.querySelector("main") && !!document.querySelector("nav"),
    page: document.body.innerText.includes("Something went wrong.") && !document.querySelector("nav"),
  }));
  is("a form that throws shows the small fallback", caught.fallback);
  is("...over an app that is still there", caught.shell);
  eq("...and not the whole-page one", caught.page, false);
  await app.page.evaluate(() => {
    [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === "Close").click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const after = await app.page.evaluate(() => ({
    fallback: document.body.innerText.includes("Something went wrong"),
    formOpen: [...document.querySelectorAll("input")].some((i) => i.value === "Dentist"),
    shell: !!document.querySelector("nav"),
  }));
  eq("Close takes it away and leaves the app as it was", after, { fallback: false, formOpen: false, shell: true });
} finally {
  await app.close();
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
