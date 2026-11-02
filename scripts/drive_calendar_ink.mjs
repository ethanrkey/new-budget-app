// The calendar's 2026-11-02 polish, driven in a real browser.
//
//   node scripts/drive_calendar_ink.mjs
//
// What tests/calendar.test.mjs cannot see, because it is classes and
// scroll positions: the legend under the grid, the new label, $0 in
// gray (a $0 occurrence and a day that nets to nothing), a projected
// overdraft in red, and the day card that no longer shrinks under the
// pointer when you go from a busy day to a quiet one.
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
// A FUTURE DAY THIS MONTH WITH NOTHING ON IT, found from the fixture's
// own ledger, so the wash pair below nets to exactly zero whatever the
// date. (A fixed offset landed on the weekly groceries.) Falls back to
// next month's grid if this month has none left.
const busy = new Set(computeLedger(st, ledgerHorizonOf(st)).rows.map((r) => r.date));
let q = 1; while (busy.has(plus(q))) q++;
const quiet = plus(q);
const acct = st.accounts[0].id;
st.oneoffs = [...(st.oneoffs ?? []),
  { id: "o-zero", name: "Skipped service", amount: 0, category: "bill", date: today, accountId: acct },
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
      cellZero: [cellZero?.textContent, /text-gray-400/.test(cellZero?.className ?? "")],
      washNet: [washNet?.textContent, /text-gray-400/.test(washNet?.className ?? "")],
      washAria: /no net change/.test(wash?.getAttribute("aria-label") ?? ""),
      negatives: neg.length,
      negativesRed: neg.every((s) => /text-expense/.test(s.className)),
      positivesInk: cells.map((b) => [...b.querySelectorAll("span.tabular-nums")][0])
        .filter((s) => s && /^\$/.test(s.textContent)).every((s) => !/text-expense/.test(s.className)),
    };
  });
  eq("one gray line under the grid says what the numbers are", seen.legend, true);
  eq("a $0 occurrence in the cell is a gray $0", seen.cellZero, ["$0", true]);
  eq("a day that nets to nothing is a gray $0", seen.washNet, ["$0", true]);
  eq("...and says so in words", seen.washAria, true);
  eq("the fixture projects an overdraft to check", seen.negatives > 0, true);
  eq("every balance below zero is red", seen.negativesRed, true);
  eq("...and no balance above it is", seen.positivesInk, true);

  // The day card, on today (which carries the $0 row).
  const card = await app.page.evaluate(() => {
    [...document.querySelectorAll("button[aria-label]")].find((b) => /, today,/.test(b.getAttribute("aria-label")))?.click();
    return new Promise((r) => setTimeout(() => {
      const main = document.querySelector("main");
      const row = [...main.querySelectorAll("ul.space-y-1 button")].find((b) => b.textContent.includes("Skipped service"))?.lastElementChild;
      r({ label: main.innerText.includes("Checking balance after:"), row: [row?.textContent, /text-gray-400/.test(row?.className ?? "")] });
    }, 300));
  });
  eq("the card says Checking balance after:", card.label, true);
  eq("...and its $0 row is '$0.00' in gray, no minus", card.row, ["$0.00", true]);

  // NO JUMP. Scrolled to the bottom, a busy day then a quiet one.
  const jump = await app.page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const count = (b) => Number(b.getAttribute("aria-label").match(/(\d+) transactions?/)?.[1] ?? 0);
    const days = [...document.querySelectorAll("button[aria-label]")].filter((b) => /balance after/i.test(b.getAttribute("aria-label")));
    const busiest = days.reduce((a, b) => (count(b) > count(a) ? b : a));
    const calm = days.find((b) => count(b) === 0);
    busiest.click(); await wait(300);
    window.scrollTo(0, document.documentElement.scrollHeight); await wait(300);
    const before = window.scrollY;
    calm.click(); await wait(300);
    return { scrolls: before > 0, moved: window.scrollY - before };
  });
  eq("the page is scrolled for this to mean anything", jump.scrolls, true);
  eq("busy day -> quiet day does not move the page", jump.moved, 0);
} finally {
  await app.close();
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
