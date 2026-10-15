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
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// The key alone, transparent. No background plate: the plate is
// `fill` below.
//
// WIDTH AND HEIGHT ARE NOT OPTIONAL, and leaving them off is what
// made build 6's key a third of the tile. An SVG with only a viewBox
// has no intrinsic size, so whatever rasterizes the layer picks its
// own — and the artwork lands tiny inside a 1024 canvas. Measured:
// the same drawing renders at 33.3% of the tile without them and
// 78.3% with them, and neither the viewBox nor the layer's `scale`
// property moves it at all while they are missing.
//
// THE FRAME IS 0 0 512 512 — exactly the flat icon's. The key then
// occupies the same fraction of the layer that it occupies of
// icon.png, so "the layered icon matches the flat one's proportions"
// is true by construction rather than by a tuned number someone has
// to re-tune.
writeFileSync(new URL("key.svg", ICON_ASSETS), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">
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
// THE LAYERED ICON IS COMPARED AGAINST THE FLAT ONE, not eyeballed.
//
// Build 6 shipped a key that filled a third of the tile and nobody
// caught it until it was on a phone, because the .icon cannot be
// previewed from here — the only way to see it is to compile it.
// `actool` can, so it does: compile the bundle, measure the slot it
// renders, and compare against icon.png, which is the composition
// that was right in build 5.
//
// Skipped loudly rather than silently when Xcode is not installed,
// because a check that quietly does nothing is worse than no check.
const ICON_SLOT_TOLERANCE = 4;   // percentage points, at a 120px render
try {
  const tmp = mkdtempSync(join(tmpdir(), "keybudget-icon-"));
  execFileSync("xcrun", [
    "actool", "--compile", tmp, "--app-icon", "KeyBudget",
    "--output-partial-info-plist", join(tmp, "partial.plist"),
    "--platform", "iphoneos", "--minimum-deployment-target", "18.0",
    "--target-device", "iphone",
    new URL("../mobile/assets/images/KeyBudget.icon", import.meta.url).pathname,
  ], { stdio: "pipe" });

  const slot = readFileSync(join(tmp, "KeyBudget60x60@2x.png"));
  const layered = await inspect(slot);
  const flatPct = shape.spanX * 100, layeredPct = layered.spanX * 100;
  console.log(`  layered icon: key spans ${layeredPct.toFixed(1)}% of the tile, flat icon ${flatPct.toFixed(1)}%`);
  if (Math.abs(layeredPct - flatPct) > ICON_SLOT_TOLERANCE) {
    console.error(`FAIL: the layered icon's key is ${layeredPct.toFixed(1)}% of the tile but the flat one is ${flatPct.toFixed(1)}% — they are the same drawing and should be the same size`);
    process.exit(1);
  }
} catch (err) {
  // ONLY A MISSING TOOLCHAIN IS A SKIP. The first version of this
  // matched /actool/ in the message, so actool REFUSING THE BUNDLE —
  // the exact failure this check exists to catch — was reported as
  // "this machine has no Xcode" and the script exited green. An
  // exception from a tool that ran is a failure.
  const msg = String(err.message ?? err);
  const stderr = String(err.stderr ?? "");
  const missing = /unable to find utility|command not found|ENOENT|no developer tools|xcode-select/i.test(msg + stderr);
  if (missing) {
    console.warn("  note: skipping the layered-icon comparison — actool needs Xcode, and this machine has none");
  } else {
    console.error("FAIL: actool could not compile the .icon bundle");
    console.error((stderr || msg).trim().split("\n").slice(-25).join("\n"));
    process.exit(1);
  }
}

await browser.close();
console.log("ICON OK");
