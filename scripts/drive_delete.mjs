// Deleting from the Ledger, driven in a real browser.
//
//   node scripts/drive_delete.mjs
//
// 2026-10-29: the row's ✕ deleted on the first click, and on a
// recurring row it deletes the whole RULE. Every delete now asks
// first, in a dialog with Cancel focused. This clicks what a user
// clicks and checks the two things that matter: nothing goes until
// Delete is pressed, and every way out of the dialog loses nothing.
//
// Not in `npm test`: it starts Vite and Chrome. Run it when the
// Ledger's delete controls or ConfirmDialog change.
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
const page = app.page;
const thrown = [];
page.on("pageerror", (e) => thrown.push(e.message));
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// How many Ledger rows carry this name.
const rows = (name) => page.evaluate((n) =>
  [...document.querySelectorAll('button[title="Edit"]')].filter((b) => b.textContent.trim() === n).length, name);
// Press the ✕ on the first row named `name`.
const cross = (name) => page.evaluate((n) => {
  const edit = [...document.querySelectorAll('button[title="Edit"]')].find((b) => b.textContent.trim() === n);
  if (!edit) throw new Error(`no row ${n}`);
  edit.closest("tr").querySelector('button[title="Delete"]').click();
}, name);
const dialog = () => page.evaluate(() => {
  const d = document.querySelector('[role="alertdialog"]');
  return d && {
    title: d.querySelector("h2")?.textContent ?? null,
    body: d.querySelector("p")?.textContent ?? null,
    focused: document.activeElement?.textContent?.trim() ?? null,
  };
});
const press = (label) => page.evaluate((l) => {
  const d = document.querySelector('[role="alertdialog"]');
  [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === l).click();
}, label);

try {
  await app.load("ledger");
  const rentBefore = await rows("Rent");
  is("the fixture has Rent rows to delete", rentBefore > 1);

  console.log("\n== a recurring row ==");
  await cross("Rent"); await settle();
  eq("the ✕ asks first, naming the rule and what goes with it", await dialog(), {
    title: "Delete Rent?", body: "This removes every date it generates.", focused: "Cancel",
  });
  eq("...and nothing has gone yet", await rows("Rent"), rentBefore);
  await page.keyboard.press("Escape"); await settle();
  eq("Escape closes it", await dialog(), null);
  eq("...and deletes nothing", await rows("Rent"), rentBefore);

  await cross("Rent"); await settle();
  await page.keyboard.press("Enter"); await settle();
  eq("Enter, with Cancel focused, closes it", await dialog(), null);
  eq("...and deletes nothing", await rows("Rent"), rentBefore);

  await cross("Rent"); await settle();
  await page.mouse.click(5, 5); await settle();
  eq("a click outside closes it", await dialog(), null);
  eq("...and deletes nothing", await rows("Rent"), rentBefore);

  await cross("Rent"); await settle();
  await press("Delete"); await settle();
  eq("Delete removes the rule, every date of it", await rows("Rent"), 0);

  console.log("\n== a one-off ==");
  await cross("Dentist"); await settle();
  eq("the ✕ asks, naming it", await dialog(), { title: "Delete Dentist?", body: null, focused: "Cancel" });
  await press("Cancel"); await settle();
  eq("Cancel keeps it", await rows("Dentist"), 1);
  await cross("Dentist"); await settle();
  await press("Delete"); await settle();
  eq("Delete removes it", await rows("Dentist"), 0);

  console.log("\n== a batch ==");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Select").click());
  await settle();
  // Two one-offs and one rule.
  for (const n of ["Flight home", "Holiday gifts", "Groceries"]) {
    await page.evaluate((name) => {
      const edit = [...document.querySelectorAll('button[title="Edit"]')].find((b) => b.textContent.trim() === name);
      edit.closest("tr").querySelector('input[type="checkbox"]').click();
    }, n);
    await settle(100);
  }
  const groceriesBefore = await rows("Groceries");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Delete selected/.test(b.textContent.trim())).click());
  await settle();
  eq("one question for the batch, saying a rule is in it", await dialog(), {
    title: "Delete 3 items?", body: "One of them is a recurring rule. This removes every date it generates.", focused: "Cancel",
  });
  await page.keyboard.press("Escape"); await settle();
  eq("Escape keeps all three", [await rows("Flight home"), await rows("Holiday gifts"), await rows("Groceries")], [1, 1, groceriesBefore]);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Delete selected/.test(b.textContent.trim())).click());
  await settle();
  await press("Delete"); await settle();
  eq("Delete removes all three", [await rows("Flight home"), await rows("Holiday gifts"), await rows("Groceries")], [0, 0, 0]);

  eq("nothing threw anywhere on the page", thrown, []);
} finally {
  await app.close();
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
