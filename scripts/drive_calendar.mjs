// The web calendar, driven in a real browser.
//
//   node scripts/drive_calendar.mjs
//
// Maintenance rule 5: verify the thing the USER touches, starting from
// the real entry point. The grid's arithmetic is covered in
// tests/calendar.test.mjs and the phone's rendering in
// mobile/__tests__/calendar.test.tsx; what neither of those can say is
// whether the web actually draws it — the web has no renderer harness,
// so this is the only thing standing between a working engine and a
// blank panel.
//
// Not in `npm test`: it starts Vite and Chrome. Run it when the
// calendar changes.
import { openFixtureApp } from "./fixtureApp.mjs";
import { todayISO, primaryAccount } from "../src/engine/model.ts";
import { fixtureState } from "./fixture.mjs";
import { fmtLongDay, fmtMonthYear } from "../src/shared/dates.ts";
import { CALENDAR_COPY } from "../src/content/calendar.ts";

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

const app = await openFixtureApp({ width: 1100, height: 1100 });
try {
  await app.load("ledger");
  await app.page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Calendar");
    if (!btn) throw new Error("no Calendar toggle");
    btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  const seen = await app.page.evaluate(() => {
    const cells = [...document.querySelectorAll("button[aria-label]")]
      .filter((b) => /^\w+day, /.test(b.getAttribute("aria-label")));
    const todayCell = cells.find((b) => b.getAttribute("aria-current") === "date");
    const panel = document.querySelector("main").innerText;
    return {
      heading: document.querySelector('button[aria-label="Previous month"]')
        ?.nextElementSibling?.textContent ?? null,
      cellCount: cells.length,
      todayLabel: todayCell?.getAttribute("aria-label") ?? null,
      todayCount: cells.filter((b) => b.getAttribute("aria-current") === "date").length,
      dimmed: cells.filter((b) => b.className.includes("opacity-40")).map((b) => b.getAttribute("aria-label")),
      withBalance: cells.filter((b) => /Balance after/.test(b.getAttribute("aria-label"))).length,
      panel,
    };
  });

  const today = todayISO();
  eq("it opens on today's month", seen.heading, fmtMonthYear(today.slice(0, 7)));
  is("the grid drew a month of cells", seen.cellCount >= 28 && seen.cellCount <= 31);
  eq("exactly one cell is today", seen.todayCount, 1);
  is("...and it is the real today", (seen.todayLabel ?? "").startsWith(fmtLongDay(today)));

  is("the detail panel is open on today", seen.panel.includes(fmtLongDay(today)));
  is("...and leads with where the balance lands", seen.panel.includes(CALENDAR_COPY.balanceAfter));
  not("NET IS GONE from the panel", /\bnet \$/i.test(seen.panel));

  // Every dimmed cell is dimmed because there is no forecast for it,
  // which is exactly the set with no balance in its label.
  eq("no dimmed cell claims a balance",
    seen.dimmed.filter((l) => /Balance after/.test(l)).length, 0);
  // And the dimmed set is exactly the days this month that fall before
  // the balance's as-of date — not "roughly the start of the month".
  const anchor = primaryAccount(fixtureState()).balanceAsOf;
  const month = today.slice(0, 7);
  const expectDim = [];
  for (let d = 1; d <= 31; d++) {
    const iso = `${month}-${String(d).padStart(2, "0")}`;
    if (iso.slice(0, 7) === month && iso < anchor) expectDim.push(fmtLongDay(iso));
  }
  eq("the dimmed days are exactly the ones before the as-of date",
    seen.dimmed.map((l) => l.split(", ").slice(0, 3).join(", ")), expectDim);
  eq("...and every other day carries a balance",
    seen.withBalance, seen.cellCount - seen.dimmed.length);

  // And a balance in a cell is a whole-dollar figure with no cents —
  // the cell's own format, not the panel's.
  const cellText = await app.page.evaluate(() => {
    const b = [...document.querySelectorAll("button[aria-label]")]
      .find((x) => /^\w+day, /.test(x.getAttribute("aria-label")) && /Balance after/.test(x.getAttribute("aria-label")));
    return b.innerText.trim();
  });
  is("a cell's number is whole dollars", /\$[\d,]+$/.test(cellText.split("\n").pop()));
  not("...with no cents", /\.\d\d/.test(cellText));
} finally {
  await app.close();
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
