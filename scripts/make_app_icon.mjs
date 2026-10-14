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
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../mobile/assets/images/icon.png", import.meta.url);
const SPLASH = new URL("../mobile/assets/images/splash-icon.png", import.meta.url);
const SIZE = 1024;

// THE MARK IS READ, NOT RESTATED. Until 2026-10-14 the geometry below
// was a copy of public/favicon.svg's, with a comment admitting it —
// "lifted from" — which is a second original waiting to drift, and the
// metallic gradient would have had to be typed into both. Now the
// source file is parsed: its <defs> (the gradient) and the contents of
// <g id="mark"> are lifted verbatim into every output. A change to the
// key is a change to one file.
//
// Deliberately a regex and not an XML parser. The input is one file in
// this repo whose shape is fixed by the two markers below, and both
// are asserted — a missing marker fails here rather than silently
// producing an icon with no key on it.
const BG = "#111827";
const SOURCE = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
const defs = (SOURCE.match(/<defs>[\s\S]*?<\/defs>/) ?? [])[0];
const mark = (SOURCE.match(/<g id="mark">([\s\S]*?)<\/g>/) ?? [])[1];
if (!defs || !mark) {
  console.error("FAIL: public/favicon.svg no longer has <defs> and <g id=\"mark\">, which this script reads");
  process.exit(1);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${SIZE}" height="${SIZE}">
  ${defs}
  <rect width="512" height="512" fill="${BG}"/>
  ${mark}
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
  ${defs}
  ${mark}
</svg>`;

// ---------------------------------------------------------------------
// THE iOS 26 LAYERED ICON.
//
// `.icon` is Icon Composer's format, and Expo SDK 57 takes one
// directly: `ios.icon` pointing at a `.icon` directory makes prebuild
// set ASSETCATALOG_COMPILER_APPICON_NAME and add the bundle to the
// Xcode project (@expo/prebuild-config, withIosIcons.js). That is the
// whole integration — no plugin, no patch.
//
// WHY IT IS WORTH IT: the system composites the layer itself, so the
// icon gets iOS 26's glass, its specular highlight, its parallax and
// its dark and tinted variants for free, all of which track whatever
// Apple changes next. A flat PNG gets none of that and never will.
//
// The background is a FILL rather than an image, and the key is the
// only layer, because that is what layering is for: a key baked onto a
// navy square is one picture, and the system has nothing to separate.
//
// AUTHORED BY HAND, which is worth being honest about. The format is
// undocumented; the schema here was read out of
// IconComposerFoundation's own symbol table (`fill`, `groups`,
// `layers`, `image-name`, `glass`, `supported-platforms`, and the
// `<color-space>:<components>` color encoding), and the shape matches
// Apple's own template at
// Xcode.app/.../Templates/File Templates/MultiPlatform/Resource/Icon
// Composer Icon.xctemplate. It could NOT be validated here, because
// actool needs `xcodebuild -runFirstLaunch` and that needs sudo. The
// validator is therefore the EAS build: actool either compiles this or
// fails loudly, and the fallback is one line in app.json back to
// icon.png.
const ICON_DIR = new URL("../mobile/assets/images/KeyBudget.icon/", import.meta.url);
const ICON_ASSETS = new URL("Assets/", ICON_DIR);
mkdirSync(ICON_ASSETS, { recursive: true });

// The key alone, transparent, full-bleed in its own square. No
// background plate: the plate is `fill` below.
writeFileSync(new URL("key.svg", ICON_ASSETS), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="33 40 440 440">
  ${defs}
  ${mark}
</svg>
`);

// #111827 in the encoding IconComposerFoundation parses: a color space
// name, a colon, then components. Five decimals, like Apple's template.
const c = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(",");
writeFileSync(new URL("icon.json", ICON_DIR), JSON.stringify({
  fill: { solid: `extended-srgb:${c(BG)},1.00000` },
  groups: [{ layers: [{ "image-name": "key.svg", glass: true }] }],
  "supported-platforms": { circles: ["watchOS"], squares: "shared" },
}, null, 2) + "\n");
console.log(`wrote ${new URL("icon.json", ICON_DIR).pathname}`);

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

writeFileSync(OUT, buf);
writeFileSync(SPLASH, splashBuf);

// THE MARK IS ON IT, and the gradient runs the way it is supposed to.
//
// This check exists because of a bug it would have caught and a human
// did not: the first metallic gradient used SVG's default
// objectBoundingBox units, and two of the key's three shapes are
// STRAIGHT LINES whose bounding boxes have zero height or zero width.
// SVG says an element with a degenerate bounding box and
// objectBoundingBox units is not rendered at all — so the shaft and
// the tooth silently disappeared and the icon became a gold ring on
// navy. It looked plausible in a thumbnail.
//
// So: count the gold, and compare the top-left half of it with the
// bottom-right half. A missing shape collapses the count; a gradient
// that is flat, inverted, or gone collapses the difference.
const inspect = async (buf) => await tab.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  let gold = 0, tlSum = 0, tlN = 0, brSum = 0, brN = 0;
  let minX = c.width, maxX = -1;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], gg = data[i + 1], b = data[i + 2], a = data[i + 3];
    // Gold is the only warm thing in the frame: red well above blue.
    if (a > 128 && r > 120 && r - b > 60) {
      gold++;
      const px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      const along = px / c.width + py / c.height;        // 0 top-left .. 2 bottom-right
      if (along < 0.8) { tlSum += r + gg + b; tlN++; }
      else if (along > 1.2) { brSum += r + gg + b; brN++; }
    }
  }
  return {
    goldFraction: gold / (c.width * c.height),
    // How much of the frame the mark SPANS left to right. This is the
    // sharp one: the key is a ring plus a shaft plus a tooth, and only
    // the shaft makes it wide.
    spanX: maxX < 0 ? 0 : (maxX - minX) / c.width,
    topLeft: tlN ? tlSum / tlN : 0,
    bottomRight: brN ? brSum / brN : 0,
  };
}, buf.toString("base64"));

const shape = await inspect(buf);
console.log(`  gold ${(shape.goldFraction * 100).toFixed(1)}% of the frame,` +
  ` spanning ${(shape.spanX * 100).toFixed(0)}% of its width,` +
  ` top-left ${shape.topLeft.toFixed(0)} vs bottom-right ${shape.bottomRight.toFixed(0)}`);

// THE NUMBERS ARE MEASURED, NOT PICKED. The whole key is 13.1% of the
// square and spans 69% of its width; the ring on its own — which is
// what the zero-bounding-box bug left behind — is 8.9% and spans 29%.
// The first version of this check floored the area at 6% and passed
// the broken icon, because a ring is more than 6%. The SPAN is what
// actually separates them: only the shaft makes the mark wide.
if (shape.goldFraction < 0.11) {
  console.error(`FAIL: only ${(shape.goldFraction * 100).toFixed(1)}% of the icon is gold — a shape is missing`);
  process.exit(1);
}
if (shape.spanX < 0.6) {
  console.error(`FAIL: the mark spans only ${(shape.spanX * 100).toFixed(0)}% of the width — the shaft is missing`);
  process.exit(1);
}
if (!(shape.topLeft > shape.bottomRight + 20)) {
  console.error("FAIL: the gradient is flat or inverted — top-left should be the lighter end");
  process.exit(1);
}

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
// ---------------------------------------------------------------------
// THE WEB'S RASTERS, from the same drawing.
//
// These nine PNGs were hand-exported once and then sat there. The
// moment the mark gained a gradient they were stale — the SVG
// favicon, which modern browsers prefer, showed metal while every
// fallback showed flat gold. "public/favicon.svg is the one place the
// mark is defined" was only true of the vector.
//
// Rounded here, unlike the iOS icon, because a browser tab and a PWA
// tile draw the square as-is — the rx comes from the source file.
// Maskable is the exception: Android masks it to whatever shape the
// launcher likes, so it is full-bleed with the key pulled into the
// 40% safe radius, and a corner-rounded source would be clipped.
const WEB = [
  ["favicon-16.png", 16], ["favicon-32.png", 32], ["favicon-48.png", 48],
  ["icon-192.png", 192], ["icon-512.png", 512],
  ["apple-touch-icon.png", 180], ["apple-touch-icon-152.png", 152], ["apple-touch-icon-167.png", 167],
];
const rounded = SOURCE.replace(/\s*<!--[\s\S]*?-->/g, "");
for (const [name, px] of WEB) {
  await tab.setViewport({ width: px, height: px, deviceScaleFactor: 1 });
  await tab.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{display:block;width:${px}px;height:${px}px}</style>${rounded}`,
    { waitUntil: "load" }
  );
  writeFileSync(new URL(`../public/${name}`, import.meta.url), await tab.screenshot({ type: "png", omitBackground: true }));
}

// Maskable: square, and the key at 72% so it survives a circular mask.
const MASK = 512;
await tab.setViewport({ width: MASK, height: MASK, deviceScaleFactor: 1 });
await tab.setContent(`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${MASK}" height="${MASK}">
  ${defs}
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(256 256) scale(0.72) translate(-253 -260)">${mark}</g>
</svg>`, { waitUntil: "load" });
writeFileSync(new URL("../public/icon-maskable-512.png", import.meta.url), await tab.screenshot({ type: "png", omitBackground: false }));
console.log(`wrote ${WEB.length + 1} web rasters from the same source`);

await browser.close();
console.log("ICON OK");
