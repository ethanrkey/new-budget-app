// The web Budget's month row is frozen, like a spreadsheet's top row.
//
//   node scripts/drive_budget_head.mjs
//
// 2026-11-07, the owner's call (the phone has it too): scrolling down
// the Budget keeps MONTH / Nov 2026 / Dec 2026 … at the top. Scrolling
// sideways keeps each label over its own column. The table's box scrolls
// both ways and is no taller than the window. See BudgetView.jsx.
// Not in `npm test`: it starts Vite and Chrome.
import { openFixtureApp } from "./fixtureApp.mjs";

let failures = 0, checks = 0;
function eq(label, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Narrow and short, so the table overflows both ways.
const app = await openFixtureApp({ width: 760, height: 640, scale: 1 });
try {
  await app.load("budget");

  // Bring the table's box to the top of the window first, the way anyone
  // reading a long budget would. The page scrolls; the table has not yet.
  await app.page.evaluate(() => {
    const box = document.querySelector("main table").parentElement;
    window.scrollBy(0, box.getBoundingClientRect().top - 8);
  });
  await wait(200);

  const geo = () => app.page.evaluate(() => {
    const box = document.querySelector("main table").parentElement;
    const b = box.getBoundingClientRect();
    const ths = [...box.querySelectorAll("thead th")];
    const rows = [...box.querySelectorAll("tbody tr")].filter((r) => r.children.length === ths.length);
    // A body row that has scrolled up to the header line: is it hidden?
    // The rightmost month in view: it can never be under MONTH.
    const shown = ths.filter((t) => { const r = t.getBoundingClientRect(); return r.left + r.width / 2 < b.right - 2; });
    const lastTh = shown[shown.length - 1];
    const last = lastTh.getBoundingClientRect();
    const hit = document.elementFromPoint(last.left + last.width / 2, last.top + last.height / 2);
    const corner = document.elementFromPoint(ths[0].getBoundingClientRect().left + 5, ths[0].getBoundingClientRect().top + 5);
    return {
      boxTop: Math.round(b.top), boxLeft: Math.round(b.left),
      boxH: box.clientHeight, contentH: box.scrollHeight, contentW: box.scrollWidth, boxW: box.clientWidth,
      viewport: window.innerHeight,
      scrollTop: box.scrollTop, scrollLeft: box.scrollLeft,
      headTops: ths.map((t) => Math.round(t.getBoundingClientRect().top)),
      cornerLeft: Math.round(ths[0].getBoundingClientRect().left),
      // Each month header's left edge against the same column in a body row.
      aligned: ths.slice(1).every((t, i) =>
        rows.every((r) => Math.abs(t.getBoundingClientRect().left - r.children[i + 1].getBoundingClientRect().left) < 1)),
      label2: ths[2].textContent.trim(),
      headOnTop: lastTh.contains(hit),
      cornerOnTop: ths[0].contains(corner),
    };
  });

  const g0 = await geo();
  eq("the table overflows both ways, so this means something",
    [g0.contentH > g0.boxH, g0.contentW > g0.boxW], [true, true]);
  eq("the table's box is no taller than the window", g0.boxH <= g0.viewport, true);

  // Down.
  // As far as it goes.
  await app.page.evaluate(() => { const b = document.querySelector("main table").parentElement; b.scrollTop = b.scrollHeight; });
  await wait(150);
  const g1 = await geo();
  eq("scrolled down inside the table, to the end", g1.scrollTop === g1.contentH - g1.boxH && g1.scrollTop > 100, true);
  eq("...and every header cell stays at the top of the box", g1.headTops.every((t) => t === g1.boxTop), true);
  eq("...over the rows, which pass under it", [g1.headOnTop, g1.cornerOnTop], [true, true]);

  // Sideways, while still scrolled down.
  await app.page.evaluate(() => { const b = document.querySelector("main table").parentElement; b.scrollLeft = b.scrollWidth; });
  await wait(150);
  const g2 = await geo();
  eq("scrolled sideways, to the end", g2.scrollLeft === g2.contentW - g2.boxW && g2.scrollLeft > 100, true);
  eq("...each month label is still over its own column", g2.aligned, true);
  eq("...the labels moved with the months", g2.label2 === g1.label2 && g2.headTops.every((t) => t === g2.boxTop), true);
  eq("...and MONTH stays in the corner", [g2.cornerLeft, g2.cornerOnTop], [g2.boxLeft, true]);
  eq("...over the months passing under it", g2.headOnTop, true);
} finally {
  await app.close();
}

console.log(`\n${failures ? `FAILED ${failures} of ${checks}` : `ALL PASS (${checks} checks)`}`);
process.exit(failures ? 1 : 0);
