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

  // ---- round two: color by direction, and the items in the cell ----
  const cells = await app.page.evaluate(() => {
    const paint = (el) => el && getComputedStyle(el).color;
    return [...document.querySelectorAll("button[aria-label]")]
      .filter((b) => /^\w+day, /.test(b.getAttribute("aria-label")))
      .map((b) => {
        const dots = [...b.querySelectorAll("span.rounded-full")].map((d) => getComputedStyle(d).backgroundColor);
        const lines = [...b.querySelectorAll(":scope > div")];
        const bal = lines.find((d) => /tabular-nums/.test(d.className) && /^\$|^-\$/.test(d.innerText.trim()));
        const net = lines.find((d) => /^[+\u2212]/.test(d.innerText.trim()));
        const items = [...b.querySelectorAll("li")].map((li) => li.innerText.replace(/\s+/g, " ").trim());
        return {
          label: b.getAttribute("aria-label"),
          dots, items,
          balColor: paint(bal), netText: net?.innerText.trim() ?? null, netColor: paint(net),
        };
      });
  });

  const busy = cells.filter((c) => /transaction/.test(c.label));
  const quiet = cells.filter((c) => !/transaction/.test(c.label) && /Balance after/.test(c.label));
  is("the month has both busy and quiet days to compare", busy.length > 2 && quiet.length > 2);

  // EVERY DOT MATCHES WHAT THE LABEL SAYS MOVED, which is the check
  // that the colors mean something rather than that they exist.
  // RESOLVED FROM THE PAGE, not hardcoded. The first attempt pinned
  // Tailwind's own red-600 and green-600 and reported seven cells
  // wrong about a palette that was right — `text-expense` and
  // `text-income` are this app's tokens, not Tailwind's defaults.
  const { red, green } = await app.page.evaluate(() => {
    const probe = (cls) => {
      const el = document.createElement("span");
      el.className = cls;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    return { red: probe("text-expense"), green: probe("text-income") };
  });
  let wrong = 0;
  for (const c of cells) {
    const want = [];
    if (/money out/.test(c.label)) want.push(red);
    if (/money in/.test(c.label)) want.push(green);
    if (JSON.stringify(c.dots.filter((d) => d === red || d === green)) !== JSON.stringify(want)) wrong++;
  }
  eq("every cell's dots say exactly what its label says moved", wrong, 0);
  is("...and at least one day has both", cells.some((c) => /money in/.test(c.label) && /money out/.test(c.label)));
  eq("a quiet day has no dot", quiet.filter((c) => c.dots.length).length, 0);

  // The balance is the bright one on a day that moved and the dim one
  // on a day that did not.
  eq("every busy day's balance is in ink", new Set(busy.map((c) => c.balColor)).size, 1);
  eq("every quiet day's balance is muted", new Set(quiet.map((c) => c.balColor)).size, 1);
  is("...and the two are different", busy[0].balColor !== quiet[0].balColor);

  // The net under it, signed and colored, and absent where nothing moved.
  eq("no quiet day prints a net", quiet.filter((c) => c.netText).length, 0);
  eq("every busy day does", busy.filter((c) => !c.netText).length, 0);
  let netWrong = 0;
  for (const c of busy) {
    const down = c.netText.startsWith("\u2212");
    if (c.netColor !== (down ? red : green)) netWrong++;
    if (!/down|up/.test(c.label)) netWrong++;
  }
  eq("every net is colored by its own sign, and said in words too", netWrong, 0);

  // The room the phone does not have.
  const cats = fixtureState().recurring.map((r) => r.name);
  is("a busy cell lists its items by name", busy.some((c) => c.items.some((t) => cats.some((n) => t.startsWith(n)))));
  eq("a quiet cell lists nothing", quiet.filter((c) => c.items.length).length, 0);

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

// ---- the cap, which needs a day the fixture does not have ----------
//
// THIS SECTION EXISTS BECAUSE THE CHECK ABOVE PASSED VACUOUSLY. No
// day in the fixture account has four items, so "never more than
// three plus a count" and "+N more when there are more than three"
// were both true of an empty set — lifting the cap to nine in the
// component changed nothing and the run stayed green. A crowded day
// has to be built on purpose.
{
  const base = fixtureState();
  const today = todayISO();
  const crowded = `${today.slice(0, 7)}-${String(Math.min(28, Number(today.slice(8)) + 3)).padStart(2, "0")}`;
  const state = {
    ...base,
    oneoffs: [
      ...base.oneoffs,
      ...["Vet", "Haircut", "Books", "Parking", "Gift"].map((name, i) => ({
        id: `o-crowd-${i}`, name, amount: 20 + i, category: "oneoff", order: 90 + i, date: crowded,
      })),
    ],
  };
  const app2 = await openFixtureApp({ width: 1100, height: 1100, state });
  try {
    await app2.load("ledger");
    await app2.page.evaluate(() => {
      [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Calendar").click();
    });
    await new Promise((r) => setTimeout(r, 400));
    // MATCHED ON THE WHOLE DATE, not the day number: "20" is in
    // "October 20" and also in "2026", and the first attempt picked
    // whichever cell came first.
    const items = await app2.page.evaluate((pretty) => {
      const b = [...document.querySelectorAll("button[aria-label]")]
        .find((x) => (x.getAttribute("aria-label") ?? "").startsWith(pretty));
      if (!b) throw new Error(`no cell for ${pretty}`);
      return {
        items: [...b.querySelectorAll("li")].map((li) => li.innerText.replace(/\s+/g, " ").trim()),
        label: b.getAttribute("aria-label"),
      };
    }, fmtLongDay(crowded));

    // HOW MANY THE DAY HAS IS READ OFF THE CELL, not assumed: the
    // five added here landed on a day the fixture already had a
    // recurring bill on, and "+2 more" was wrong about a cell that
    // was right.
    const total = Number(items.label.match(/(\d+) transactions/)[1]);
    is("the crowded day really is crowded", total > 4);
    eq("a crowded cell lists three and then counts the rest", items.items.length, 4);
    is("...and the last line is the count", /^\+\d+ more$/.test(items.items[3] ?? ""));
    eq("...naming how many are hidden", items.items[3], `+${total - 3} more`);
  } finally { await app2.close(); }
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
