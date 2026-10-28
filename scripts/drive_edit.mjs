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
} finally {
  await app.close();
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
