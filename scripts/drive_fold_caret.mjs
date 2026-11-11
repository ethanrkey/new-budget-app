// The Planned spending "fold back into Other" control is just the caret.
//
//   node scripts/drive_fold_caret.mjs
//
// The owner's call, 2026-11-11, web only: under the opened Other list
// the control read "Fold N back into Other". It is now only the caret,
// still a button, and its accessible name keeps the words so a screen
// reader announces it. This opens the panel on the real page, opens
// Other, and checks the control shows no text, is named, and still
// folds the list back.
import { openFixtureApp } from "./fixtureApp.mjs";
import { fixtureState } from "./fixture.mjs";

let failures = 0, checks = 0;
function is(label, ok, detail = "") {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n        ${detail}`}`);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await openFixtureApp({ width: 1100, height: 900, state: fixtureState() });
try {
  await app.load("ledger");
  const { page } = app;
  const click = (pick) => page.evaluate(pick);

  // Open the panel if this device keeps it folded.
  await click(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Planned spending/.test(x.textContent));
    if (b && b.getAttribute("aria-expanded") === "false") b.click();
  });
  await pause(400);
  // Open Other: the row button whose text starts with "Other".
  const opened = await click(() => {
    const b = [...document.querySelectorAll("button[aria-expanded='false']")].find((x) => /^\s*Other/.test(x.textContent));
    if (!b) return false;
    b.click();
    return true;
  });
  is("the fixture's breakdown has an Other to open", opened);
  await pause(300);

  const fold = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /^Fold \d+ back into Other$/.test(x.getAttribute("aria-label") ?? ""));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { label: b.getAttribute("aria-label"), text: b.textContent.trim(), svg: !!b.querySelector("svg"), w: r.width, h: r.height };
  });
  is("the fold control is there, named for a screen reader", !!fold, "no button labeled \"Fold N back into Other\"");
  if (fold) {
    is("...and shows no text, only the caret", fold.text === "" && fold.svg, JSON.stringify(fold));
    is("...with a target bigger than the 12px caret", fold.w >= 20 && fold.h >= 20, `${fold.w}x${fold.h}`);
  }

  await click(() => [...document.querySelectorAll("button")].find((x) => /^Fold \d+ back into Other$/.test(x.getAttribute("aria-label") ?? ""))?.click());
  await pause(300);
  const folded = await page.evaluate(() => ({
    fold: [...document.querySelectorAll("button")].some((x) => /^Fold/.test(x.getAttribute("aria-label") ?? "")),
    other: [...document.querySelectorAll("button[aria-expanded='false']")].some((x) => /^\s*Other/.test(x.textContent)),
  }));
  is("clicking it folds the list back into Other", !folded.fold && folded.other, JSON.stringify(folded));
} finally {
  await app.close();
}

if (checks < 4) { console.log(`FAIL  only ${checks} checks ran`); failures++; }
console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
