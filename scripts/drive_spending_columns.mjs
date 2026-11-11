// The web Spending tab's cards share one set of columns.
//
//   node scripts/drive_spending_columns.mjs
//
// Reported 2026-11-11 (web only): Month / Expected / Actual / Difference
// sat at different places in each card (Electric, Gas, Groceries,
// Discover Bill), because each card's table sized its own columns from
// its own contents. This reads the real page in a browser and checks
// that every card's header cells AND its body cells start and end at
// the same x, at a desktop width and at a narrow one. Measured, because
// "the same classes on every card" is not the same thing as "lined up".
import { openFixtureApp } from "./fixtureApp.mjs";
import { fixtureState } from "./fixture.mjs";

let failures = 0, checks = 0;
function is(label, ok, detail = "") {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n        ${detail}`}`);
}

/** Per card: its name and the [left, right] of each column, from the header and every row. */
const measure = (page) => page.evaluate(() => {
  const tables = [...document.querySelectorAll("main table")]
    .filter((t) => /Expected/.test(t.querySelector("thead")?.textContent ?? ""));
  return tables.map((t) => {
    const card = t.closest(".rounded-lg");
    const name = card?.querySelector(".font-medium")?.firstChild?.textContent?.trim() ?? "?";
    const edges = (row) => [...row.children].map((c) => {
      const r = c.getBoundingClientRect();
      return [Math.round(r.left * 10) / 10, Math.round(r.right * 10) / 10];
    });
    return { name, head: edges(t.querySelector("thead tr")), rows: [...t.querySelectorAll("tbody tr")].map(edges) };
  });
});

for (const width of [1100, 640]) {
  const app = await openFixtureApp({ width, height: 900, state: fixtureState() });
  try {
    await app.load("spending");
    const cards = await measure(app.page);
    is(`${width}px: there are cards to compare`, cards.length >= 2, `found ${cards.length}`);
    console.log(`        ${cards.map((c) => c.name).join(", ")}`);
    const ref = JSON.stringify(cards[0]?.head);
    for (const c of cards) {
      is(`${width}px: ${c.name}'s header columns sit where ${cards[0].name}'s do`,
        JSON.stringify(c.head) === ref, `${JSON.stringify(c.head)} vs ${ref}`);
      const off = c.rows.filter((r) => JSON.stringify(r) !== ref);
      is(`${width}px: every ${c.name} row lines up with the header`, off.length === 0,
        off.length ? JSON.stringify(off[0]) : "");
    }
  } finally {
    await app.close();
  }
}

// A SUITE THAT RUNS NO CHECKS EXITS 0.
if (checks < 6) { console.log(`FAIL  only ${checks} checks ran`); failures++; }
console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
