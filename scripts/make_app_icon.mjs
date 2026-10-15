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
// THE PHONE'S ICON IS A FLAT PNG AND NOTHING ELSE, which is a
// decision this script carried the other way for four builds. From
// build 6 to build 9 it also wrote `KeyBudget.icon`, Icon Composer's
// layered format, so that iOS 26 would composite its own glass over
// the key. On a real phone that glass turns the ring faceted — an
// octagon with shaded edges — because the system RE-RENDERS a layered
// icon rather than drawing it. Build 9 shipped geometry identical to
// build 5's and still looked wrong, which is what finally separated
// the artwork from the pipeline. Reverted 2026-10-15 by the owner's
// call: ship exactly what build 5 shipped, the same way, and the two
// checks at the bottom of this file hold it there.
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
// <defs> is OPTIONAL and <g id="mark"> is not. The mark has to be
// there or every output is a navy square; a <defs> only exists when
// the drawing needs one, and since the 2026-10-15 revert to build 5's
// flat gold it does not. Requiring one here would have made removing
// the gradient a failing build for no reason.
const defs = (SOURCE.match(/<defs>[\s\S]*?<\/defs>/) ?? [])[0] ?? "";
const mark = (SOURCE.match(/<g id="mark">([\s\S]*?)<\/g>/) ?? [])[1];
if (!mark) {
  console.error("FAIL: public/favicon.svg no longer has <g id=\"mark\">, which this script reads");
  process.exit(1);
}
// NO NESTED GROUP INSIDE THE MARK, and this is not fussiness. The
// regex above is non-greedy, so it stops at the first </g> — an inner
// one — and the layer written below gets an unclosed tag. That
// happened on 2026-10-15 when the fillets were first wrapped in a <g>:
// Chrome's parser repaired the file and every PNG looked correct,
// while actool refused the whole bundle with "Exception Raised during
// asset import". Refusing here is the difference between a two-minute
// fix and finding out from a failed build.
if (/<g[\s>]/.test(mark.replace(/<!--[\s\S]*?-->/g, ""))) {
  console.error("FAIL: <g id=\"mark\"> contains a nested <g>, which the non-greedy regex above would truncate. Flatten it.");
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

// THE MARK IS ON IT, AND IT IS THE RIGHT SIZE.
//
// This check exists because of two bugs it would have caught and a
// human did not. The first metallic gradient used SVG's default
// objectBoundingBox units, and two of the key's three shapes are
// STRAIGHT LINES whose bounding boxes have zero height or zero width.
// SVG says an element with a degenerate bounding box and
// objectBoundingBox units is not rendered at all — so the shaft and
// the tooth silently disappeared and the icon became a gold ring on
// navy. It looked plausible in a thumbnail. The second was build 6's
// layered icon, whose key filled a third of the tile.
//
// So: count the gold, and measure how wide the mark is.
const inspect = async (buf) => await tab.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  let gold = 0;
  let minX = c.width, maxX = -1;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], b = data[i + 2], a = data[i + 3];
    // Gold is the only warm thing in the frame: red well above blue.
    if (a > 128 && r > 120 && r - b > 60) {
      gold++;
      const px = (i / 4) % c.width;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
    }
  }
  return {
    goldFraction: gold / (c.width * c.height),
    // How much of the frame the mark SPANS left to right. This is the
    // sharp one: the key is a ring plus a shaft plus a tooth, and only
    // the shaft makes it wide.
    spanX: maxX < 0 ? 0 : (maxX - minX) / c.width,
  };
}, buf.toString("base64"));

const shape = await inspect(buf);
console.log(`  gold ${(shape.goldFraction * 100).toFixed(1)}% of the frame,` +
  ` spanning ${(shape.spanX * 100).toFixed(1)}% of its width`);

// THE NUMBERS ARE MEASURED, NOT PICKED. The whole key is 13.1% of the
// square and spans 68.8% of its width; the ring on its own — which is
// what the zero-bounding-box bug left behind — is 8.9% and spans 29%.
// The first version of this check floored the area at 6% and passed
// the broken icon, because a ring is more than 6%. The SPAN is what
// actually separates them: only the shaft makes the mark wide.
//
// BUILD_5_SPAN is the composition the owner signed off on from a
// device, and on 2026-10-15 the drawing was reverted to exactly that
// artwork. It is an equality check with a point and a half of slack
// for antialiasing, not a floor: a key that grew as well as a key that
// shrank is a regression, and build 6's third-of-a-tile key is what
// a floor alone fails to catch.
const BUILD_5_SPAN = 68.8;
const SPAN_TOLERANCE = 1.5;
if (shape.goldFraction < 0.11) {
  console.error(`FAIL: only ${(shape.goldFraction * 100).toFixed(1)}% of the icon is gold — a shape is missing`);
  process.exit(1);
}
if (Math.abs(shape.spanX * 100 - BUILD_5_SPAN) > SPAN_TOLERANCE) {
  console.error(`FAIL: the mark spans ${(shape.spanX * 100).toFixed(1)}% of the width, and build 5's spans ${BUILD_5_SPAN}% — the composition moved`);
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

// GOOGLE'S OAUTH CONSENT SCREEN. The Google Cloud Branding page takes
// a 120x120 PNG and shows it on the "Sign in with Google" sheet beside
// the app's name. Generated here rather than exported by hand for the
// same reason as everything else above: a logo Google shows to users
// is the mark, and the mark has one definition.
//
// SQUARE AND OPAQUE, unlike the web rasters. Google draws it in a
// circle, so the rounded corners would be masked off anyway — and a
// corner-rounded source inside a circle leaves four transparent
// slivers where the rounding cuts inside the circle. Full-bleed navy
// survives any mask they choose.
const GOOGLE = 120;
await tab.setViewport({ width: GOOGLE, height: GOOGLE, deviceScaleFactor: 1 });
await tab.setContent(`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:${BG}}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${GOOGLE}" height="${GOOGLE}">
  ${defs}
  <rect width="512" height="512" fill="${BG}"/>
  ${mark}
</svg>`, { waitUntil: "load" });
writeFileSync(new URL("../public/google-branding-120.png", import.meta.url), await tab.screenshot({ type: "png", omitBackground: false }));

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
console.log(`wrote ${WEB.length + 2} web rasters from the same source`);

// ---------------------------------------------------------------------
// IT IS COMPARED, PIXEL FOR PIXEL, AGAINST THE ICON BUILD 5 SHIPPED.
//
// Builds 6 to 9 all failed the same way and the last of them failed
// with a correct drawing: on 2026-10-15 `public/favicon.svg` was
// reverted to build 5's geometry exactly and build 9 STILL came off
// the phone wrong — a faceted, octagonal ring with glass shading on
// its edges. The artwork was right and the PIPELINE was wrong. Build 5
// shipped a flat PNG; 6 to 9 shipped `KeyBudget.icon`, and iOS 26
// re-renders a layered icon rather than drawing it, so the system's
// own glass pass is applied to the mark whatever the mark is.
//
// Every check above this line reads the SVG, which means every check
// above this line would have passed build 9. So the check that
// belongs here is the one the owner asked for: compare against build
// 5's actual icon, not against the drawing it was made from.
//
// THE REFERENCE IS A BUILD ARTIFACT, NOT A SECOND ORIGINAL. It is
// `AppIcon60x60@2x.png` lifted out of build 5's own IPA
// (02fadd39-8ea0-46ca-895b-616ae9989b14, commit fec01220), run
// through `pngcrush -revert-iphone-optimizations` because Apple
// stores a CgBI variant no browser can decode. Nothing is ever
// GENERATED from it — it is only ever compared against — so it cannot
// drift into being a second definition of the mark the way a second
// SVG would. When the key is redrawn (the owner's own project), this
// file is replaced deliberately, in the same commit, from the first
// build of the new one.
//
// THE TOLERANCE IS MEASURED, NOT PICKED. Chrome's downscale and
// actool's do not agree to the bit, so this is a mean absolute
// channel difference over the 120x120 render, and the three numbers
// that set the threshold were measured here on 2026-10-15:
//
//     build 5's own artwork (what ships now)   0.81
//     the build 6-7 metallic gradient          2.30
//     the build 8 filleted key                 2.34
//
// 1.5 sits between them with most of a point of margin on each side.
// A regression that changes the mark's COLOR or its JUNCTIONS — the
// two things that actually went wrong — lands on the far side of it.
const BUILD_5_MEAN_TOLERANCE = 1.5;
const reference = readFileSync(new URL("./fixtures/build5-appicon-120.png", import.meta.url));
const diff = await tab.evaluate(async (a, b) => {
  const px = async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 120; c.height = 120;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, 120, 120);
    return g.getImageData(0, 0, 120, 120).data;
  };
  const x = await px(a), y = await px(b);
  let sum = 0, n = 0, max = 0;
  for (let i = 0; i < x.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(x[i + k] - y[i + k]);
      sum += d; n++; if (d > max) max = d;
    }
  }
  return { mean: sum / n, max };
}, buf.toString("base64"), reference.toString("base64"));

console.log(`  against build 5's shipped icon: mean channel difference ${diff.mean.toFixed(2)}, worst pixel ${diff.max}`);
if (diff.mean > BUILD_5_MEAN_TOLERANCE) {
  console.error(`FAIL: this is not the icon build 5 shipped — mean channel difference ${diff.mean.toFixed(2)}, and build 5's own artwork scores 0.81`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// AND IT IS SHIPPED THE WAY BUILD 5 SHIPPED IT.
//
// This is the actual root cause of builds 6 through 9, and no amount
// of measuring the PNG finds it: the PNG was fine and app.json sent
// iOS somewhere else. `ios.icon` pointing at a `.icon` directory makes
// prebuild set ASSETCATALOG_COMPILER_APPICON_NAME to the layered
// bundle, and the flat PNG this script spent 300 lines getting right
// is then never drawn on a phone at all.
//
// So the config is asserted here, next to the artwork, rather than
// trusted. Build 5's ios block had no `icon` key; this is that, as a
// check.
const appJson = JSON.parse(readFileSync(new URL("../mobile/app.json", import.meta.url), "utf8"));
if (appJson.expo?.icon !== "./assets/images/icon.png") {
  console.error(`FAIL: app.json's expo.icon is ${JSON.stringify(appJson.expo?.icon)}, not the PNG this script writes`);
  process.exit(1);
}
if (appJson.expo?.ios?.icon !== undefined) {
  console.error(`FAIL: app.json sets ios.icon to ${JSON.stringify(appJson.expo.ios.icon)} — that is the layered bundle builds 6-9 shipped, and iOS 26 re-renders it`);
  process.exit(1);
}
console.log("  app.json ships the flat PNG, with no ios.icon override");

await browser.close();
console.log("ICON OK");
