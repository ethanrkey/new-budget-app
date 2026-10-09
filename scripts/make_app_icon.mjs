// The iOS app icon, generated from the same drawing as the web icon.
//
//   node scripts/make_app_icon.mjs
//
// WHY A SCRIPT AND NOT A FILE. `public/favicon.svg` is the one place the
// Key Budget mark is defined; every raster beside it (favicon-16/32/48,
// icon-192/512, apple-touch-icon) is derived from it. Shipping a
// hand-exported PNG into mobile/ would make a second original that drifts
// the first time the mark changes — the same mistake the screenshots and
// the README each made once already. So the phone's icon is generated too.
//
// TWO DELIBERATE DIFFERENCES from the web raster, and both matter:
//
//   1. NO ROUNDED CORNERS. The web icon carries rx=96 because a browser
//      tab and a PWA tile draw the square as-is. iOS applies its OWN
//      squircle mask to every app icon, so a pre-rounded source gets
//      rounded twice and the result is a dark halo pinched in at each
//      corner. The source must be a full-bleed square.
//   2. NO ALPHA. Apple rejects an App Store icon with an alpha channel.
//      Rendering onto an opaque background rather than compositing is what
//      guarantees that, and the check at the bottom proves it rather than
//      trusting it.
//
// 1024x1024 because that is the size App Store Connect takes and the size
// Expo's asset pipeline downsamples every other slot from. Generating at
// 1024 from vector geometry is also why this is not an upscale of the
// 512 PNG: there is no 512 in the path at all.
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../mobile/assets/images/icon.png", import.meta.url);
const SPLASH = new URL("../mobile/assets/images/splash-icon.png", import.meta.url);
const SIZE = 1024;

// The mark, at 512 units, lifted from public/favicon.svg with the rounded
// rect replaced by a full square. Kept as geometry rather than as an <img>
// of the svg so the background is painted by the same pass as the key and
// no transparent pixel is ever created.
const BG = "#111827";
const GOLD = "#eebb4d";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${SIZE}" height="${SIZE}">
  <rect width="512" height="512" fill="${BG}"/>
  <circle cx="176" cy="256" r="74" fill="none" stroke="${GOLD}" stroke-width="50"/>
  <path d="M250 256 H 404" fill="none" stroke="${GOLD}" stroke-width="50" stroke-linecap="round"/>
  <path d="M372 256 V 340" fill="none" stroke="${GOLD}" stroke-width="46" stroke-linecap="round"/>
</svg>`;

const page = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:${BG}}svg{display:block}</style>
${svg}`;

// The splash mark: the same key, no background plate, drawn larger in the
// frame because expo-splash-screen's `contain` fits the whole image and a
// full-bleed square would letterbox into a postage stamp. The screen's
// color comes from `backgroundColor` in app.json, so this one KEEPS its
// alpha — the opposite of the rule above, and for the opposite reason.
//
// The viewBox is the key's own bounding box plus margin, computed rather
// than eyeballed: the strokes extend half a stroke-width past their
// geometry and the round caps extend half again, so the mark spans
// x 77..429 and y 157..363, centered on (253, 260). A square 440 across
// from that center leaves the key at about 80% of the frame. The first
// attempt guessed the box and clipped both ends.
const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="33 40 440 440" width="${SIZE}" height="${SIZE}">
  <circle cx="176" cy="256" r="74" fill="none" stroke="${GOLD}" stroke-width="50"/>
  <path d="M250 256 H 404" fill="none" stroke="${GOLD}" stroke-width="50" stroke-linecap="round"/>
  <path d="M372 256 V 340" fill="none" stroke="${GOLD}" stroke-width="46" stroke-linecap="round"/>
</svg>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell" });
const tab = await browser.newPage();
await tab.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });
await tab.setContent(page, { waitUntil: "load" });
const buf = await tab.screenshot({ type: "png", omitBackground: false });

await tab.setContent(
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{display:block}</style>${splashSvg}`,
  { waitUntil: "load" }
);
const splashBuf = await tab.screenshot({ type: "png", omitBackground: true });
await browser.close();

writeFileSync(OUT, buf);
writeFileSync(SPLASH, splashBuf);

// Prove it, rather than assume it. An icon that is the wrong size or
// carries alpha fails at upload time, which is the worst moment to find
// out — so the two properties Apple checks are checked here.
const probe = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", OUT.pathname], { encoding: "utf8" });
const read = (k) => (probe.match(new RegExp(`${k}:\\s*(\\S+)`)) ?? [])[1];
const w = read("pixelWidth"), h = read("pixelHeight"), alpha = read("hasAlpha");
const bytes = readFileSync(OUT).length;

console.log(`wrote ${OUT.pathname}`);
console.log(`  ${w}x${h}, hasAlpha=${alpha}, ${bytes} bytes`);
if (w !== String(SIZE) || h !== String(SIZE)) { console.error(`FAIL: expected ${SIZE}x${SIZE}`); process.exit(1); }
if (alpha !== "no") { console.error("FAIL: Apple rejects an app icon with an alpha channel"); process.exit(1); }
console.log("ICON OK");
