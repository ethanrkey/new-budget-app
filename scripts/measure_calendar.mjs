// Does a whole month AND the day panel fit a laptop screen?
//
//   node scripts/measure_calendar.mjs [width] [height]
//
// Reported 2026-10-17: the web calendar needed scrolling to see one
// month plus the detail panel on a 13-14" laptop. The target is a
// 1440x800 viewport — the smallest common laptop once the browser
// chrome is off — for a typical month.
//
// MEASURED FROM THE VIEWPORT, not from the grid: what matters is
// whether the bottom of the panel is above the fold, which depends
// on everything stacked above it (the header, the action row, the
// tabs, the Planned spending panel) and not on the calendar alone.
import { openFixtureApp } from "./fixtureApp.mjs";
import { fixtureState } from "./fixture.mjs";
import { todayISO } from "../src/engine/model.ts";

const WIDTH = Number(process.argv[2] ?? 1440);
const HEIGHT = Number(process.argv[3] ?? 800);

// THREE MONTHS, NOT ONE. "Fits" is a claim about the worst case a
// person will actually meet, and the fixture's own October is the
// easy one: five weeks, nothing busier than two items a day. A month
// that spills into a sixth week is a whole extra row, and a day with
// five things on it is the tallest row the cell can produce.
const base = fixtureState();
const TODAY = todayISO();
const crowdedDate = `${TODAY.slice(0, 7)}-${String(Math.min(28, Number(TODAY.slice(8)) + 3)).padStart(2, "0")}`;
const CASES = [
  { name: "the fixture's own month", state: undefined },
  { name: "...a six-week month", state: undefined, weeks: 6 },
  {
    name: "...with a five-item day",
    state: {
      ...base,
      oneoffs: [
        ...base.oneoffs,
        ...["Vet", "Haircut", "Books", "Parking", "Gift"].map((n, i) => ({
          id: `o-m-${i}`, name: n, amount: 20 + i, category: "oneoff", order: 90 + i, date: crowdedDate,
        })),
      ],
    },
  },
];

let failures = 0;
for (const c of CASES) {
  const over = await measure(c.state, c.weeks);
  console.log(over <= 0
    ? `FITS  ${String(-over).padStart(3)}px to spare   ${c.name}`
    : `OVER  ${String(over).padStart(3)}px below fold  ${c.name}`);
  if (over > 0) failures++;
}
process.exit(failures === 0 ? 0 : 1);

async function measure(state, wantWeeks) {
  const app = await openFixtureApp({ width: WIDTH, height: HEIGHT, scale: 1, state });
  try {
  await app.load("ledger");
  await app.page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Calendar").click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // Page forward until the grid draws the number of weeks asked for.
  // A six-week month is a whole extra row and they happen four or
  // five times a year, so it is a case and not an edge.
  if (wantWeeks) {
    for (let i = 0; i < 14; i++) {
      const weeks = await app.page.evaluate(() => {
        const g = [...document.querySelectorAll(".grid.grid-cols-7")].find((x) => x.querySelector("button[aria-label]"));
        return new Set([...g.children].map((c) => Math.round(c.getBoundingClientRect().top))).size;
      });
      if (weeks >= wantWeeks) break;
      const moved = await app.page.evaluate(() => {
        const b = document.querySelector('button[aria-label="Next month"]');
        if (b.disabled) return false;
        b.click();
        return true;
      });
      if (!moved) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const m = await app.page.evaluate(() => {
    // THE SECOND grid-cols-7 on the page: the first is the weekday
    // header, which is also a seven-column grid and is 24px tall.
    const grid = [...document.querySelectorAll(".grid.grid-cols-7")]
      .find((g) => g.querySelector("button[aria-label]"));
    const panel = grid.parentElement.lastElementChild;
    const cells = [...grid.children].filter((c) => c.tagName === "BUTTON");
    const rowTops = [...new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top)))];
    return {
      weeks: rowTops.length,
      gridTop: Math.round(grid.getBoundingClientRect().top),
      gridBottom: Math.round(grid.getBoundingClientRect().bottom),
      panelBottom: Math.round(panel.getBoundingClientRect().bottom),
      rowHeights: rowTops.map((t, i) =>
        Math.round((rowTops[i + 1] ?? grid.getBoundingClientRect().bottom) - t)),
      docHeight: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
      scrollable: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  });

  console.log(`  ${WIDTH}x${m.viewport}  ${m.weeks} weeks  rows ${m.rowHeights.join("/")}  ` +
    `grid ${m.gridTop}-${m.gridBottom}  panel ends ${m.panelBottom}`);
  return m.panelBottom - m.viewport;
  } finally {
    await app.close();
  }
}
