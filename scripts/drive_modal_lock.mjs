// A modal locks the page behind it, in a real browser with a real wheel.
//
//   node scripts/drive_modal_lock.mjs
//
// 2026-11-03: with Settings → Account open, the mouse wheel scrolled the
// page behind the modal. Every scrim is now <ModalBackdrop>
// (src/components/ModalBackdrop.jsx); tests/modal-lock.test.mjs is the
// gate and the counting, this is the thing the user touches:
//
//   - the wheel over a modal, and over its scrim, does not move the page
//   - a modal taller than the window scrolls itself, and wheeling on past
//     its end still does not move the page
//   - a confirm stacked on Settings, closed, leaves the page locked
//   - the page does not shift sideways when the scrollbar goes
//   - closing puts the page back exactly where it was, and it scrolls again
//
// Not in `npm test`: it starts Vite and Chrome.
import { openFixtureApp } from "./fixtureApp.mjs";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Short, so Settings (max-h 90vh) is taller than the window and scrolls.
const app = await openFixtureApp({ width: 1100, height: 520, scrollbars: true });
const { page } = app;
const scrollY = () => page.evaluate(() => window.scrollY);
const click = (text, scope = "document") => page.evaluate((t, s) => {
  const root = s === "modal" ? [...document.querySelectorAll("[data-modal]")].pop() : document;
  const b = [...root.querySelectorAll("button")].find((x) => x.textContent.trim() === t);
  if (!b) throw new Error(`no "${t}" button`);
  b.click();
}, text, scope);
async function wheelAt(sel, dy, times = 6) {
  const box = await page.evaluate((s) => {
    const r = [...document.querySelectorAll(s)].pop().getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 200) };
  }, sel);
  await page.mouse.move(box.x, box.y);
  for (let i = 0; i < times; i++) { await page.mouse.wheel({ deltaY: dy }); await wait(40); }
  await wait(300);
}
// The scrim, away from the panel: its top-left corner.
async function wheelOnScrim(dy) {
  await page.mouse.move(8, 8);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: dy }); await wait(40); }
  await wait(300);
}

try {
  await app.load("ledger");
  // A CLASSIC SCROLLBAR, as on Windows or a Mac set to "always". Chrome
  // on a Mac draws overlay ones that take no room, which would make the
  // no-shift check below pass for nothing; styling it makes it classic.
  await page.addStyleTag({ content: "::-webkit-scrollbar { width: 15px; } ::-webkit-scrollbar-thumb { background: #999; }" });
  await wait(100);
  // A page long enough to scroll, scrolled somewhere in the middle.
  const room = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  eq("the Ledger is taller than the window", room > 400, true);
  await page.evaluate(() => window.scrollTo(0, 300));
  await wait(200);
  const before = await scrollY();
  const leftBefore = await page.evaluate(() => document.querySelector("main").getBoundingClientRect().left);
  const gutter = await page.evaluate(() => innerWidth - document.documentElement.clientWidth);

  eq("the page has a 15px scrollbar that takes room", gutter, 15);

  await click("⚙ Settings");
  await wait(300);
  eq("Settings is open", await page.evaluate(() => document.querySelectorAll("[data-modal]").length), 1);
  eq("...the page is locked", await page.evaluate(() => document.documentElement.style.overflow), "hidden");
  eq("...and nothing behind it moved sideways as its scrollbar went",
    await page.evaluate(() => document.querySelector("main").getBoundingClientRect().left), leftBefore);

  await wheelOnScrim(200);
  eq("the wheel on the scrim does not scroll the page", await scrollY(), before);

  const panel = "[data-modal] > div";
  const tall = await page.evaluate((s) => { const p = document.querySelector(s); return p.scrollHeight > p.clientHeight; }, panel);
  eq("Settings is taller than this window", tall, true);
  await wheelAt(panel, 120, 3);
  const mid = await page.evaluate((s) => document.querySelector(s).scrollTop, panel);
  eq("the wheel on Settings scrolls Settings", mid > 0, true);
  eq("...and not the page", await scrollY(), before);
  await wheelAt(panel, 400, 12);
  const end = await page.evaluate((s) => { const p = document.querySelector(s); return Math.abs(p.scrollTop + p.clientHeight - p.scrollHeight) < 2; }, panel);
  eq("wheeling on reaches Settings' end", end, true);
  eq("...and past its end the page still has not moved", await scrollY(), before);
  await page.keyboard.press("PageDown");
  await page.keyboard.press("End");
  await wait(300);
  eq("nor does the keyboard move it", await scrollY(), before);

  // STACKED: "Wipe all data" opens its own modal on top of Settings.
  await click("Wipe all data", "modal");
  await wait(300);
  eq("the confirm opens on top", await page.evaluate(() => document.querySelectorAll("[data-modal]").length), 2);
  await wheelAt("[data-modal]", 300);
  eq("the wheel over the confirm does not scroll the page", await scrollY(), before);
  await click("Cancel", "modal");
  await wait(300);
  eq("closing the confirm leaves Settings open", await page.evaluate(() => document.querySelectorAll("[data-modal]").length), 1);
  eq("...and the page still locked", await page.evaluate(() => document.documentElement.style.overflow), "hidden");
  await wheelOnScrim(300);
  eq("...so the wheel still cannot scroll it", await scrollY(), before);

  // SETTINGS → ACCOUNT, the report itself: a sibling modal, not stacked.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .filter((x) => x.textContent.trim() === "Manage")
      .find((x) => /Account/.test(x.parentElement.textContent));
    if (!b) throw new Error("no Account > Manage");
    b.click();
  });
  await wait(300);
  eq("Account is open in Settings' place", await page.evaluate(() => document.querySelectorAll("[data-modal]").length), 1);
  await wheelAt("[data-modal] > div", 300);
  await wheelOnScrim(300);
  eq("the wheel in Account does not scroll the page (the report)", await scrollY(), before);
  eq("...still locked across the swap", await page.evaluate(() => document.documentElement.style.overflow), "hidden");

  await page.keyboard.press("Escape");
  await wait(200);
  if (await page.evaluate(() => document.querySelectorAll("[data-modal]").length)) {
    await page.mouse.click(8, 8); // the scrim closes it
    await wait(300);
  }
  eq("Account closed", await page.evaluate(() => document.querySelectorAll("[data-modal]").length), 0);
  eq("the page is unlocked", await page.evaluate(() => document.documentElement.style.overflow), "");
  eq("...with no padding left behind", await page.evaluate(() => document.body.style.paddingRight), "");
  eq("...exactly where it was", await scrollY(), before);
  await page.mouse.move(550, 300);
  await page.mouse.wheel({ deltaY: 200 });
  await wait(400);
  eq("...and the wheel scrolls it again", (await scrollY()) > before, true);
} finally {
  await app.close();
}
console.log(`\n${failures ? `FAILED ${failures} of ${checks}` : `ALL PASS (${checks} checks)`}`);
process.exit(failures ? 1 : 0);
