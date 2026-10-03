// Landing-page screenshots, regenerated from fixture data.
//
//   node scripts/screenshots.mjs            # all three
//   node scripts/screenshots.mjs ledger     # just one
//
// Why this is a script. The first set was taken by hand on 2026-10-02 and
// was wrong by the next afternoon: the role palette landed and the public
// page went on advertising eight retired hues and a "Savings columns" label
// the app no longer uses. A screenshot is DERIVED from the UI, so it rots
// exactly like a generated file and has to be regenerable like one.
//
// The account shown is invented (scripts/fixture.mjs) and dated relative to
// today, so a regeneration months from now produces a current-looking
// account rather than one whose newest reading is stale. A public page is
// the last place a real balance should appear.
import { writeFileSync } from "node:fs";
import { openFixtureApp } from "./fixtureApp.mjs";

// 1100 CSS px at 2x. Wide enough for the Budget's seven month columns
// without a horizontal scrollbar in the shot. The heights are chosen to cut
// in whitespace rather than through a row, and Landing.jsx's width/height
// attributes must match them — see the note on FEATURES there.
const WIDTH = 1100;
const SHOTS = [
  { tab: "dashboard", height: 728 },
  { tab: "ledger", height: 688 },
  { tab: "budget", height: 1010 },
];

async function main() {
  const only = process.argv[2];
  const shots = only ? SHOTS.filter((s) => s.tab === only) : SHOTS;
  if (shots.length === 0) throw new Error(`unknown tab: ${only}`);

  const app = await openFixtureApp({ width: WIDTH });
  try {
    for (const { tab, height } of shots) {
      await app.load(tab);
      const top = await app.page.evaluate(() =>
        Math.round(document.querySelector("main").getBoundingClientRect().top + window.scrollY));
      const buf = await app.page.screenshot({
        captureBeyondViewport: true,
        clip: { x: 0, y: top, width: WIDTH, height },
      });
      writeFileSync(`public/screenshots/${tab}.png`, buf);
      console.log(`public/screenshots/${tab}.png  ${WIDTH * 2}x${height * 2}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
