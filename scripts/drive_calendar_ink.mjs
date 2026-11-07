// The calendar's 2026-11-02 polish, driven in a real browser.
//
//   node scripts/drive_calendar_ink.mjs
//
// What tests/calendar.test.mjs cannot see, because it is classes and
// scroll positions: the legend under the grid, the new label, $0 in
// gray (a $0 occurrence and a day that nets to nothing), a projected
// overdraft in red, and the day card that no longer shrinks under the
// pointer when you go from a busy day to a quiet one, and a click
// moving the page to the best spot for the day's card (OTA 22).
//
// Not in `npm test`: it starts Vite and Chrome.
import { openFixtureApp } from "./fixtureApp.mjs";
import { fixtureState } from "./fixture.mjs";
import { todayISO, ledgerHorizonOf } from "../src/engine/model.ts";
import { computeLedger } from "../src/engine/compute.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}

const st = fixtureState();
const today = todayISO();
const plus = (n) => {
  const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// TWO FUTURE DAYS IN ONE MONTH WITH NOTHING ON THEM, found from the
// fixture's own ledger: one for the $0 row and one for the wash pair,
// so each cell holds only what is being checked, whatever the date.
// (A fixed offset landed on the weekly groceries; on 2026-11-03 the $0
// row shared today with a fixture bill, and the first free day was
// tomorrow, which is where the Tuition below goes.) Both from two days
// out, in the first month that has two.
const busy = new Set(computeLedger(st, ledgerHorizonOf(st)).rows.map((r) => r.date));
const free = [];
for (let n = 2; free.length < 60 && n < 120; n++) if (!busy.has(plus(n))) free.push(plus(n));
const month = free.map((d) => d.slice(0, 7)).find((m, i, all) => all.indexOf(m) !== all.lastIndexOf(m));
const [zeroDay, quiet] = free.filter((d) => d.startsWith(month));
const acct = st.accounts[0].id;
st.oneoffs = [...(st.oneoffs ?? []),
  { id: "o-zero", name: "Skipped service", amount: 0, category: "bill", date: zeroDay, accountId: acct },
  { id: "o-in", name: "Wash in", amount: 500, category: "income", date: quiet, accountId: acct },
  { id: "o-out", name: "Wash out", amount: 500, category: "bill", date: quiet, accountId: acct },
  // Big enough to take the projection below zero from here on.
  { id: "o-big", name: "Tuition", amount: 9000, category: "bill", date: plus(1), accountId: acct },
];

const app = await openFixtureApp({ width: 1100, height: 700, state: st });
try {
  await app.load("ledger");
  await app.page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Calendar").click());
  await new Promise((r) => setTimeout(r, 500));
  if (quiet.slice(0, 7) !== today.slice(0, 7)) {
    await app.page.evaluate(() => document.querySelector('[aria-label="Next month"]').click());
    await new Promise((r) => setTimeout(r, 300));
  }

  const seen = await app.page.evaluate(() => {
    const main = document.querySelector("main");
    const cells = [...document.querySelectorAll("button[aria-label]")];
    const cellZero = [...main.querySelectorAll("li span")].find((s) => s.previousElementSibling?.textContent === "Skipped service");
    const wash = cells.find((b) => b.innerText.includes("Wash in"));
    const washNet = wash && [...wash.querySelectorAll("span.tabular-nums")][1];
    const neg = cells.map((b) => [...b.querySelectorAll("span.tabular-nums")][0]).filter((s) => s?.textContent.startsWith("-$"));
    return {
      legend: main.innerText.includes("Checking balance at end of day · future days are projected"),
      legendInk: (() => {
        const p = [...main.querySelectorAll("p")].find((x) => x.textContent === "Checking balance at end of day · future days are projected");
        const bal = cells.map((b) => [...b.querySelectorAll("span.tabular-nums")][0])
          .find((x) => x && /^\$/.test(x.textContent));
        return p && bal ? [getComputedStyle(p).color === getComputedStyle(bal).color, getComputedStyle(p).fontSize] : null;
      })(),
      cellZero: [cellZero?.textContent, /text-gray-400/.test(cellZero?.className ?? "")],
      washNet: [washNet?.textContent, /text-gray-400/.test(washNet?.className ?? "")],
      washAria: /no net change/.test(wash?.getAttribute("aria-label") ?? ""),
      negatives: neg.length,
      negativesRed: neg.every((s) => /text-expense/.test(s.className)),
      positivesInk: cells.map((b) => [...b.querySelectorAll("span.tabular-nums")][0])
        .filter((s) => s && /^\$/.test(s.textContent)).every((s) => !/text-expense/.test(s.className)),
    };
  });
  eq("one line under the grid says what the numbers are", seen.legend, true);
  // IN THE BALANCES' INK since 2026-11-07 (white in the dark theme,
  // dark in light; this fixture is light). Was gray. Same 10px.
  eq("...in the same ink as the balances, at the same size", seen.legendInk, [true, "10px"]);
  eq("a $0 occurrence in the cell is a gray $0", seen.cellZero, ["$0", true]);
  eq("a day that nets to nothing is a gray $0", seen.washNet, ["$0", true]);
  eq("...and says so in words", seen.washAria, true);
  eq("the fixture projects an overdraft to check", seen.negatives > 0, true);
  eq("every balance below zero is red", seen.negativesRed, true);
  eq("...and no balance above it is", seen.positivesInk, true);

  // The day card, on the day that carries the $0 row.
  const card = await app.page.evaluate(() => {
    [...document.querySelectorAll("button[aria-label]")].find((b) => b.innerText.includes("Skipped service"))?.click();
    return new Promise((r) => setTimeout(() => {
      const main = document.querySelector("main");
      const row = [...main.querySelectorAll("ul.space-y-1 button")].find((b) => b.textContent.includes("Skipped service"))?.lastElementChild;
      r({ label: main.innerText.includes("Checking balance after:"), row: [row?.textContent, /text-gray-400/.test(row?.className ?? "")] });
    }, 300));
  });
  eq("the card says Checking balance after:", card.label, true);
  eq("...and its $0 row is '$0.00' in gray, no minus", card.row, ["$0.00", true]);

  // THE PAGE GOES TO THE BEST SPOT FOR THE CARD, either way (OTA 22):
  // the lowest scroll position at which all of it is in the window,
  // zero if it fits at the top. A busy day scrolls down to it; a short
  // day after it glides back UP rather than leaving you scrolled past a
  // calendar that no longer needs it.
  const GAP = 16;
  const move = await app.page.evaluate(async (GAP) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const count = (b) => Number(b.getAttribute("aria-label").match(/(\d+) transactions?/)?.[1] ?? 0);
    const days = [...document.querySelectorAll("button[aria-label]")].filter((b) => /balance after/i.test(b.getAttribute("aria-label")));
    const busiest = days.reduce((a, b) => (count(b) > count(a) ? b : a));
    const calm = days.find((b) => count(b) === 0);
    const card = () => document.querySelector('[data-testid="calendar-day-card"]');
    // At the lowest spot: the whole card is in the window, and either the
    // page is at the top or the card's bottom sits on the line.
    const atSpot = () => {
      const r = card().getBoundingClientRect(), line = innerHeight - GAP;
      return r.top >= 0 && r.bottom <= line + 1 && (scrollY === 0 || Math.abs(r.bottom - line) <= 1);
    };
    window.scrollTo(0, 0); await wait(100);
    busiest.click(); await wait(900);
    const busy = { y: scrollY, atSpot: atSpot(), h: card().offsetHeight };
    calm.click();
    await wait(60);
    const midway = scrollY;
    const space = () => document.querySelector('[data-testid="calendar-day-space"]');
    const heldMidway = space().offsetHeight >= busy.h;
    await wait(900);
    const quiet = { y: scrollY, atSpot: atSpot(), h: card().offsetHeight };
    const root = document.documentElement;
    return { busy, midway, quiet, spaceHeld: heldMidway,
      collapsed: space().offsetHeight === card().offsetHeight,
      // How far the page can still be scrolled down once it settled, and
      // how much page there is under the card's bottom edge.
      roomLeft: root.scrollHeight - innerHeight - scrollY,
      underCard: root.scrollHeight - (scrollY + card().getBoundingClientRect().bottom),
      cardInSpace: space().contains(card()) };
  }, GAP);
  eq("the busy day needed a scroll, so this means something", move.busy.y > 0, true);
  eq("...and the page went to the lowest spot that shows its whole card", move.busy.atSpot, true);
  eq("a short day after it moves the page back UP", move.quiet.y < move.busy.y, true);
  eq("...to the lowest spot that shows its card (zero if it fits)", move.quiet.atSpot, true);
  eq("...gliding, not snapping: it was partway there 60ms in",
    move.midway < move.busy.y && move.midway > move.quiet.y, true);
  // THE CARD SIZES TO WHAT IT SAYS; the room is held below it. OTA 20
  // held it in the card and a quiet day drew a big empty box.
  eq("the quiet day's card is shorter than the busy one's", move.quiet.h < move.busy.h, true);
  eq("...while the page moved, the space it sits in held the busy height", move.spaceHeld, true);
  // ...and once it settled, let it go (2026-11-03): no big empty area
  // to scroll down into under a short card.
  eq("once the page settles the space hugs the card", move.collapsed, true);
  eq("...without moving the page (still at the spot)", move.quiet.atSpot, true);
  // What is left under the card is the page's own bottom padding (main's
  // pb-16 plus the panel's), the same on every tab, and nothing else:
  // the space under the card adds nothing once collapsed.
  eq("...so all that is under the card is the page's own padding (under 100px)",
    move.underCard < 100, true);
  eq("...and the page can scroll on only by that padding, less the 16px gap",
    Math.abs(move.roomLeft - (move.underCard - GAP)) <= 1, true);
  eq("...with the card inside that space", move.cardInSpace, true);

  // Paging a month is not a tap on a day: the page stays where it is.
  const paged = await app.page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.scrollTo(0, 120); await wait(100);
    const before = scrollY;
    document.querySelector('[aria-label="Next month"]').click(); await wait(600);
    return { before, after: scrollY };
  });
  eq("changing month does not scroll", paged.after, paged.before);
} finally {
  await app.close();
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
