// Cumulative columns: off and closed for a new account.
//
//   node scripts/drive_columns.mjs
//
// Reported 2026-10-17: after restoring the demo backup the Ledger's
// cumulative columns were showing. The question was whether that is
// the import restoring the backup's own setting or the default for a
// new account, and the only way to answer it is to look at both —
// reasoning from `blankState()` would miss anything that turns them
// on later, which is exactly the class of thing being asked about.
import { openFixtureApp } from "./fixtureApp.mjs";
import { fixtureState } from "./fixture.mjs";
import { blankState } from "../src/engine/model.ts";

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

/** What the Ledger's columns control is showing, read off the page. */
const readColumns = (page) => page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")]
    .find((b) => /^Cumulative columns/.test(b.textContent.trim()));
  if (!btn) return null;
  // The dropdown is rendered only while open.
  const open = !!btn.parentElement.querySelector('input[type="checkbox"]');
  // MEASURED, NOT COUNTED. Every tracker column is always in the DOM:
  // a `<th>` has to exist to animate open from zero width, so asking
  // whether the name appears answers the wrong question. The one that
  // matters is whether it takes up any room.
  const head = [...document.querySelectorAll("th")]
    .map((t) => ({ name: t.textContent.trim(), w: Math.round(t.getBoundingClientRect().width) }));
  return { label: btn.textContent.trim(), open, head };
});

// ---- a used account that has never touched the control ------------
{
  const s = fixtureState();
  // Everything the fixture has, EXCEPT a columns choice: this is an
  // account somebody has used without ever opening that menu.
  const untouched = { ...s, settings: { ...s.settings, visibleTrackerCategoryIds: [] } };
  const app = await openFixtureApp({ width: 1100, height: 1000, state: untouched });
  try {
    await app.load("ledger");
    const seen = await readColumns(app.page);
    is("the control is there", !!seen);
    eq("no count beside it, because none are on", seen.label, "Cumulative columns ▾");
    not("the menu is closed", seen.open);
    const width = (name) => seen.head.find((h) => h.name === name)?.w ?? -1;
    eq("...and every category's column is collapsed to nothing",
      s.trackerCategories.map((c) => width(c.name)), s.trackerCategories.map(() => 0));
  } finally { await app.close(); }
}

// ...and the engine agrees, which is where the default actually lives.
eq("a brand-new account has no columns chosen",
  blankState().settings.visibleTrackerCategoryIds, []);

// ---- the demo backup, which DOES carry a choice --------------------
{
  const s = fixtureState();
  const chosen = ["c-roth", "c-brok", "c-save"];
  const restored = { ...s, settings: { ...s.settings, visibleTrackerCategoryIds: chosen } };
  const app = await openFixtureApp({ width: 1400, height: 1000, state: restored });
  try {
    await app.load("ledger");
    const seen = await readColumns(app.page);
    eq("a restored backup's own choice is honored, and counted",
      seen.label, `Cumulative columns (${chosen.length}) ▾`);
    not("...but the MENU is still closed", seen.open);
    const width = (name) => seen.head.find((h) => h.name === name)?.w ?? -1;
    const named = (id) => s.trackerCategories.find((c) => c.id === id).name;
    is("...and the three it names take up room",
      chosen.every((id) => width(named(id)) > 40));
    eq("...while the two it does not are still collapsed",
      ["c-sloan", "c-car"].map((id) => width(named(id))), [0, 0]);
  } finally { await app.close(); }
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
