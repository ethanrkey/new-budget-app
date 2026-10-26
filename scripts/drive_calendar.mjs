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
  // And the dimmed set is exactly the days this month that fall
  // before the balance's as-of date AND have no logged reading on
  // them — not "roughly the start of the month". A past day the user
  // recorded a balance on holds a fact and reads like one.
  const fixture = fixtureState();
  const anchor = primaryAccount(fixture).balanceAsOf;
  const loggedDates = new Set(
    (fixture.accountSnapshots?.[primaryAccount(fixture).id] ?? []).map((sn) => sn.date),
  );
  const month = today.slice(0, 7);
  const expectDim = [];
  const expectLogged = [];
  for (let d = 1; d <= 31; d++) {
    const iso = `${month}-${String(d).padStart(2, "0")}`;
    if (iso.slice(0, 7) !== month || iso >= anchor) continue;
    (loggedDates.has(iso) ? expectLogged : expectDim).push(fmtLongDay(iso));
  }
  eq("the dimmed days are the ones before the as-of date with nothing logged",
    seen.dimmed.map((l) => l.split(", ").slice(0, 3).join(", ")), expectDim);
  is("the fixture has a logged day in this month to check", expectLogged.length > 0);
  eq("...and a past day WITH a reading is not among them",
    expectLogged.filter((l) => seen.dimmed.some((d) => d.startsWith(l))).length, 0);
  eq("...every forecast day carries a balance",
    seen.withBalance, seen.cellCount - seen.dimmed.length - expectLogged.length);

  // REAL HISTORY, AND TAGGED AS SUCH. The past could be filled by
  // running the rules backwards; it would be fiction.
  const history = await app.page.evaluate((pretty) => {
    const b = [...document.querySelectorAll("button[aria-label]")]
      .find((x) => (x.getAttribute("aria-label") ?? "").startsWith(pretty));
    if (!b) throw new Error(`no cell for ${pretty}`);
    return { text: b.innerText.replace(/\s+/g, " ").trim(), label: b.getAttribute("aria-label") };
  }, expectLogged[0]);
  is("a past logged day names its reading in the cell", /\$[\d,]+/.test(history.text));
  // THE CELL IS JUST THE NUMBER, like every other cell. A "logged"
  // tag under it shipped for one round and came back out.
  not("...and wears no tag", /logged/i.test(history.text));
  is("...while the label still says which it is", history.label.includes(CALENDAR_COPY.loggedBalance));
  not("...and never calls it a forecast", history.label.includes(CALENDAR_COPY.balanceAfter));

  // ...and the panel is where the distinction lives, so tapping it
  // has to produce the other sentence.
  const panelAfterTap = await app.page.evaluate((pretty) => {
    const b = [...document.querySelectorAll("button[aria-label]")]
      .find((x) => (x.getAttribute("aria-label") ?? "").startsWith(pretty));
    b.click();
    return new Promise((r) => setTimeout(() => r(document.querySelector("main").innerText), 200));
  }, expectLogged[0]);
  is("tapping a past logged day says Logged balance in the panel",
    panelAfterTap.includes(CALENDAR_COPY.loggedBalance));
  not("...and not Balance after", panelAfterTap.includes(CALENDAR_COPY.balanceAfter));

  // SETTLE BEFORE READING THE GRID AGAIN. That click re-renders, and
  // reading the cells straight after it caught a half-rendered grid
  // about one run in three — which reported real behavior as broken
  // and, worse, reported it inconsistently.
  //
  // WAITS FOR THE PANEL'S OWN HEADING rather than for a cell that
  // says "money in". That was the settle condition until
  // 2026-10-26, when it stopped being one: late in a month every
  // payday can fall before the anchor, and the drive hung for five
  // seconds and then died waiting for a cell that was never coming.
  // A settle check has to be about rendering, not about the data.
  await app.page.waitForFunction(
    (pretty) => (document.querySelector("main")?.innerText ?? "").includes(pretty),
    { timeout: 5000 }, expectLogged[0] && fmtLongDay(expectLogged[0]),
  );

  // ---- round two: color by direction, and the items in the cell ----
  //
  // ON NEXT MONTH, NOT THIS ONE. Everything below needs a month with
  // a mix of busy and quiet forecast days, and THIS month stops
  // being one as the month wears on: the anchor is two days back, so
  // by the 26th there were six forecast days left and two of them
  // had anything on them. The drive failed on 2026-10-26 with
  // nothing broken — the date had moved. Next month is always whole
  // and always entirely forecast, which is the only month that can
  // be relied on to hold both kinds of day on all 31 starting dates.
  await app.page.evaluate(() => {
    document.querySelector('button[aria-label="Next month"]').click();
  });
  await app.page.waitForFunction(
    () => [...document.querySelectorAll("button[aria-label]")]
      .filter((b) => /^\w+day, /.test(b.getAttribute("aria-label")))
      .some((b) => /money in/.test(b.getAttribute("aria-label"))),
    { timeout: 5000 },
  );
  const cells = await app.page.evaluate(() => {
    const paint = (el) => el && getComputedStyle(el).color;
    return [...document.querySelectorAll("button[aria-label]")]
      .filter((b) => /^\w+day, /.test(b.getAttribute("aria-label")))
      .map((b) => {
        const dots = [...b.querySelectorAll("span.rounded-full")].map((d) => getComputedStyle(d).backgroundColor);
        const lines = [...b.querySelectorAll(":scope > div")];
        // The balance and the net share a line since the compaction,
        // so the net is a span beside the balance rather than a div
        // under it.
        const balLine = lines.find((d) => /tabular-nums/.test(d.innerHTML) && /\$/.test(d.innerText));
        const spans = balLine ? [...balLine.querySelectorAll("span")] : [];
        const bal = spans[0] ?? balLine;
        const net = spans.find((x) => /^[+\u2212]/.test(x.innerText.trim()));
        const dayNum = b.querySelector("span");
        const items = [...b.querySelectorAll("li")].map((li) => li.innerText.replace(/\s+/g, " ").trim());
        // THE WHOLE BOX, not its top. The two sit on a shared
        // BASELINE and are different sizes, so their tops differ by
        // a pixel or two by design; what distinguishes one line from
        // two is whether the boxes overlap at all.
        const box = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
        };
        return {
          label: b.getAttribute("aria-label"),
          dots, items,
          balColor: paint(bal), dayColor: paint(dayNum),
          netText: net?.innerText.trim() ?? null, netColor: paint(net),
          // MEASURED, because this one is a fact about layout and
          // nothing in the DOM says it. See the assertion below.
          balBox: box(bal), netBox: box(net),
          cellHeight: Math.round(b.getBoundingClientRect().height),
        };
      });
  });

  const busy = cells.filter((c) => /transaction/.test(c.label));
  const quiet = cells.filter((c) => !/transaction/.test(c.label) && /Balance after/.test(c.label));
  is("the month has both busy and quiet days to compare", busy.length > 2 && quiet.length > 2);

  // THE NET SHARES THE BALANCE'S LINE, and this is measured rather
  // than read off the markup — moving it to a line of its own
  // changes one className and nothing else, so every DOM check in
  // this file passed happily with the compaction undone. It cost
  // ~11px on every busy row, 55px of a five-row month, which was
  // the difference between the grid and its panel fitting an 800px
  // laptop and not.
  {
    const withNet = busy.filter((c) => c.netBox && c.balBox);
    is("there are busy days with a net to measure", withNet.length > 0);
    const stacked = withNet.filter((c) =>
      !(c.netBox.top < c.balBox.bottom && c.balBox.top < c.netBox.bottom));
    eq("the net sits on the balance's own line, not under it", stacked.length, 0);
    // And a quiet cell stays short. The old min-height held every
    // row at 132px whether or not anything was in it.
    const shortest = Math.min(...quiet.map((c) => c.cellHeight));
    is(`a quiet cell is still compact (${shortest}px)`, shortest < 80);
  }

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

  // EVERY BALANCE IS IN THE SAME INK, busy day or quiet. It was
  // dimmer on quiet days for one round and that read as two kinds of
  // balance; the dots and the +/- line are what tell them apart.
  eq("every balance in the month is the same color",
    new Set([...busy, ...quiet].map((c) => c.balColor)).size, 1);
  is("...and it is not the muted one the day number wears",
    busy[0].balColor !== busy[0].dayColor);

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

  // TOP-ALIGNED, which only shows in a quiet cell sharing a row with
  // a busy one — a button centers its content vertically in Chrome,
  // so the cell's own height is no evidence either way.
  const align = await app.page.evaluate(() => {
    const grid = [...document.querySelectorAll(".grid.grid-cols-7")].find((g) => g.querySelector("button[aria-label]"));
    const cells = [...grid.children].filter((c) => c.tagName === "BUTTON");
    const byRow = new Map();
    for (const c of cells) {
      const top = Math.round(c.getBoundingClientRect().top);
      (byRow.get(top) ?? byRow.set(top, []).get(top)).push(c);
    }
    // A row where the cells differ in CONTENT height is the only one
    // that can show the difference. scrollHeight is no use — a flex
    // column does not overflow, so it equals the stretched height.
    const content = (c) =>
      c.lastElementChild.getBoundingClientRect().bottom - c.firstElementChild.getBoundingClientRect().top;
    for (const row of byRow.values()) {
      const contents = row.map(content);
      if (Math.max(...contents) - Math.min(...contents) < 20) continue;
      return {
        found: true,
        gaps: row.map((c) =>
          Math.round(c.firstElementChild.getBoundingClientRect().top - c.getBoundingClientRect().top)),
      };
    }
    return { found: false, gaps: [] };
  });
  is("there is a row with a short cell beside a tall one", align.found);
  is("...and every cell in it starts its content at the top",
    align.gaps.length > 0 && Math.max(...align.gaps) - Math.min(...align.gaps) <= 1);

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
      ...["Vet", "Haircut", "Books", "Parking", "Gift", "Cab"].map((name, i) => ({
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
    eq("a crowded cell lists four and then counts the rest", items.items.length, 5);
    is("...and the last line is the count", /^\+\d+ more$/.test(items.items[4] ?? ""));
    eq("...naming how many are hidden", items.items[4], `+${total - 4} more`);
  } finally { await app2.close(); }
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
