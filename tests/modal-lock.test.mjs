// A modal locks the page behind it, and cannot forget to.
//
//   node tests/modal-lock.test.mjs     (runs in `npm test`, so in CI)
//
// 2026-11-03: with Settings → Account open, the wheel scrolled the page
// behind the modal. None of the web's full-window scrims locked it.
// They now all render <ModalBackdrop>, which does. Two halves here:
//
//   1. THE GATE. A `fixed inset-0` element with a background is a scrim,
//      and a scrim anywhere but ModalBackdrop.jsx fails the build. The
//      only bare `fixed inset-0` left are the invisible click-away
//      layers under the three dropdown menus, which are not modals
//      (no background, and the page should keep scrolling under a menu).
//   2. THE COUNT, with a stand-in document: stacked modals, the
//      scrollbar's width paid back, the page put back where it was.
//
// The real thing, wheel and all, in a browser: scripts/drive_modal_lock.mjs.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}

console.log("\n== every scrim is a ModalBackdrop ==");
{
  const dir = new URL("../src/components/", import.meta.url);
  const scrims = [], clickAways = [];
  let users = 0;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsx") && n !== "ModalBackdrop.jsx")) {
    const src = readFileSync(new URL(f, dir), "utf8");
    if (src.includes("<ModalBackdrop")) users++;
    for (const m of src.matchAll(/className="([^"]*\bfixed inset-0\b[^"]*)"/g)) {
      (/\bbg-/.test(m[1]) ? scrims : clickAways).push(f);
    }
  }
  eq("no scrim draws its own fixed inset-0", scrims, []);
  eq("...the bare ones left are the three menus' click-away layers",
    clickAways.sort(), ["AccountStrip.jsx", "ExportMenu.jsx", "LedgerView.jsx"]);
  eq("...and the modals use the backdrop (17 files)", users, 17);
}

// ---- The counted lock, against a stand-in document ------------------
const out = await build({
  entryPoints: [new URL("../src/shared/scrollLock.js", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "node",
  external: ["react", "react-dom", "react/*"], jsx: "automatic", logLevel: "silent",
});
// Inside the repo, so `react` resolves from node_modules.
const cache = new URL("../node_modules/.cache/modal-lock-test/", import.meta.url);
mkdirSync(cache, { recursive: true });
const file = new URL("bundle.mjs", cache);
writeFileSync(file, out.outputFiles[0].text);
const { lockPageScroll, unlockPageScroll } = await import(file.href);

const html = { style: { overflow: "" }, clientWidth: 1185 };
const body = { style: { paddingRight: "" } };
const scrolls = [];
globalThis.document = { documentElement: html, body };
globalThis.getComputedStyle = () => ({ paddingRight: "0px" });
const win = globalThis.window = {
  innerWidth: 1200, scrollX: 0, scrollY: 640,
  scrollTo: (o) => scrolls.push(o),
};

console.log("\n== one modal ==");
lockPageScroll();
eq("the page stops scrolling", html.style.overflow, "hidden");
eq("...and the 15px scrollbar is paid back, so nothing shifts", body.style.paddingRight, "15px");
win.scrollY = 700; // something nudged it while it was locked
unlockPageScroll();
eq("closing it unlocks", html.style.overflow, "");
eq("...gives the padding back", body.style.paddingRight, "");
eq("...and puts the page back exactly, without animating", scrolls.pop(), { left: 0, top: 640, behavior: "instant" });

console.log("\n== a confirm on top of Settings ==");
win.scrollY = 300;
lockPageScroll();   // Settings
lockPageScroll();   // its confirm
unlockPageScroll(); // the confirm closes
eq("closing the top one leaves the page locked", html.style.overflow, "hidden");
eq("...and does not move it", scrolls.length, 0);
unlockPageScroll(); // Settings closes
eq("closing the last one unlocks", html.style.overflow, "");
eq("...back where it was before the first", scrolls.pop(), { left: 0, top: 300, behavior: "instant" });
unlockPageScroll(); // a stray extra close
lockPageScroll();
eq("an extra close cannot leave the count below zero", html.style.overflow, "hidden");
unlockPageScroll();

console.log("\n== no scrollbar (overlay scrollbars, a phone) ==");
html.clientWidth = 1200;
lockPageScroll();
eq("no padding is added", body.style.paddingRight, "");
unlockPageScroll();

console.log(`\n${failures ? `FAILED ${failures} of ${checks}` : `ALL PASS (${checks} checks)`}`);
process.exit(failures ? 1 : 0);
