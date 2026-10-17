// The demo backup, put through the real Import dialog in a real browser.
//
//   node scripts/demo_account.mjs && node scripts/drive_demo_restore.mjs
//
// Maintenance rule 5: verify the thing the USER touches, from the real
// entry point. `isPlausibleBackup` inside the generator is the
// generator checking its own homework; this is the app's own file
// picker reading the file off disk and saying what it found.
//
// It stops BEFORE pressing Restore. The write path is existing code
// with its own coverage, and the fixture harness intercepts Supabase —
// so pressing it would prove nothing about the file and would be
// testing the intercept.
import { readFileSync, existsSync } from "node:fs";
import { openFixtureApp } from "./fixtureApp.mjs";
import { countSnapshots, countMonthlyActuals } from "../src/engine/backupShape.ts";
import { fmtDate } from "../src/shared/dates.ts";

const FILE = process.argv[2] ?? "demo-account.json";
if (!existsSync(FILE)) throw new Error(`${FILE} is not there — run scripts/demo_account.mjs first`);
const demo = JSON.parse(readFileSync(FILE, "utf8"));

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, c) => eq(label, !!c, true);

const app = await openFixtureApp({ width: 1100, height: 1000 });
try {
  await app.load();
  await app.page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Import/.test(b.textContent));
    if (!btn) throw new Error("no Import button");
    btn.click();
  });
  const input = await app.page.waitForSelector('input[type="file"]');
  await input.uploadFile(FILE);
  await app.page.waitForFunction(
    () => /Full backup/.test(document.body.innerText) || /text-expense/.test(document.body.innerHTML),
    { timeout: 10_000 },
  );
  const panel = await app.page.evaluate(() => document.body.innerText);

  is("the app recognizes it as a full backup, not a CSV", /Full backup — exact restore/.test(panel));
  is("...and reports no error", !/Couldn't read|not a recognized/i.test(panel));

  // The summary the user reads before pressing the button has to be
  // the file's own numbers, not a shape the dialog guessed.
  is(`${demo.recurring.length} recurring rules`, panel.includes(`${demo.recurring.length} recurring rule`));
  is(`${demo.oneoffs.length} one-off transactions`, panel.includes(`${demo.oneoffs.length} one-off transaction`));
  is(`${demo.trackerCategories.length} tracked categories`,
    panel.includes(`${demo.trackerCategories.length} savings/debt categor`));
  is(`${countSnapshots(demo.balanceSnapshots)} logged balance snapshots`,
    panel.includes(`${countSnapshots(demo.balanceSnapshots)} logged balance snapshot`));
  is(`${countMonthlyActuals(demo.monthlyActuals)} logged variable-bill actuals`,
    panel.includes(`${countMonthlyActuals(demo.monthlyActuals)} logged variable-bill actual`));
  is("the checking balance and its as-of date",
    panel.includes(`as of ${fmtDate(demo.accounts[0].balanceAsOf)}`));

  // The button is behind the confirm box, and stays behind it.
  const before = await app.page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Restore backup")?.disabled);
  eq("Restore is disabled until the box is ticked", before, true);
} finally {
  await app.close();
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
