// Where the sparkline's readout sits. Pure arithmetic, so it is here
// rather than in the renderer suite — jest cannot measure a layout,
// and this is entirely a question about numbers.
//
// THE BUG, from the build 12 device pass: while scrubbing the readout
// sat over the finger and looked right; at rest it floated at a fixed
// spot LEFT of the last point, "so it reads like it belongs to a
// different point". The readout lived in a fixed 150pt box with
// centered text, and the BOX was clamped rather than the text, so at
// the right edge the text ended up half a box-width short of its
// point — a constant gap that only vanished near the middle.
import { readoutLeft } from "../mobile/lib/readout.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) { failures++; console.log(`FAIL  ${label}\n      got  ${show(got)}\n      want ${show(want)}`); }
  else console.log(`PASS  ${label}`);
}
const is = (label, v) => eq(label, !!v, true);

console.log("== the sparkline readout's position ==");

// A card on a 390pt phone: chart 330 wide, plot inset 8, so the end
// points sit at x=8 and x=322. A readout like "$3,255.50" over
// "10/14/2026" measures around 70.
const W = 330, PAD = 8, TW = 70;
const first = PAD, last = W - PAD;

// ---- THE THREE POSITIONS THAT WERE ASKED FOR ------------------------
{
  // At rest: right-aligned over the LAST point. Its right edge lands
  // on the point, not 75pt short of it.
  const atRest = readoutLeft(last, TW, W, PAD);
  eq("at rest the readout ends exactly on the last point", atRest + TW, last);

  // Dragged to the first point: left-aligned over it.
  const atStart = readoutLeft(first, TW, W, PAD);
  eq("at the first point it starts exactly on it", atStart, first);

  // Anywhere in the middle: centered on the point.
  const mid = (first + last) / 2;
  eq("in the middle it is centered on its point", readoutLeft(mid, TW, W, PAD) + TW / 2, mid);
}

// ---- WHAT THE OLD BEHAVIOR LOOKED LIKE ------------------------------
//
// The number that makes this a bug rather than a nicety: a 150pt box
// with centered text, clamped as a box, left the resting readout's
// CENTER 75pt inside the right edge, which is 67pt away from the
// point it labels.
{
  const BOX = 150;
  const oldBoxLeft = Math.max(0, Math.min(W - BOX, last - BOX / 2));
  const oldTextCenter = oldBoxLeft + BOX / 2;
  eq("the old resting readout was 67pt from its point", last - oldTextCenter, 67);
  const nowCenter = readoutLeft(last, TW, W, PAD) + TW / 2;
  eq("...and now it is 35, which is half the readout — it is ON the point",
    last - nowCenter, TW / 2);
}

// ---- IT NEVER LEAVES THE PLOT, AND NEVER JUMPS ----------------------
{
  let worstLeft = Infinity, worstRight = -Infinity, maxStep = 0, prev = null;
  for (let x = first; x <= last; x += 0.5) {
    const l = readoutLeft(x, TW, W, PAD);
    worstLeft = Math.min(worstLeft, l);
    worstRight = Math.max(worstRight, l + TW);
    if (prev != null) maxStep = Math.max(maxStep, Math.abs(l - prev));
    prev = l;
  }
  // THE LABEL CARRIES NO MEASUREMENT, and that is not a style
  // preference. The mutation runner keys its kill map by test NAME,
  // and compares the names that died against the names from an
  // unmutated baseline run — so a label with a number in it is a
  // DIFFERENT test under every mutation that moves the number, and
  // the baseline's version comes back reported as one nothing could
  // kill. The first version of these two interpolated `worstLeft`
  // and `worstRight`; the diff-scoped run on 2026-10-16 shows them
  // under their mutated names ("min 0", "max 330"), which is what
  // gave it away. Failures print the numbers instead.
  if (!(worstLeft >= PAD - 1e-9)) console.log(`      left edge reached ${worstLeft}, plot starts ${PAD}`);
  is("it never crosses the left edge of the plot", worstLeft >= PAD - 1e-9);
  if (!(worstRight <= last + 1e-9)) console.log(`      right edge reached ${worstRight}, plot ends ${last}`);
  is("it never crosses the right edge of the plot", worstRight <= last + 1e-9);
  // CONTINUITY is the thing a two-branch fix would have broken: an
  // alignment that flips from centered to right-aligned makes the
  // readout jump by half its width mid-drag. Clamping one number
  // cannot.
  if (!(maxStep <= 0.5 + 1e-9)) console.log(`      biggest jump was ${maxStep} for a 0.5 step`);
  is("it moves at most as fast as the finger", maxStep <= 0.5 + 1e-9);
}

// ---- the cases nobody tries -----------------------------------------
{
  // Before the first layout the width is unknown. Pinning it to the
  // plot's left edge is wrong-looking for one frame, which is why the
  // component keeps it invisible until measured — but it must not be
  // NaN or negative.
  eq("an unmeasured readout is pinned, not NaN", readoutLeft(last, 0, W, PAD), last);

  // A readout wider than the plot cannot be clamped into it. Pin it
  // left rather than letting min/max invert and push it off the other
  // side — a seven-figure balance on a narrow phone.
  eq("a readout wider than the plot is pinned left", readoutLeft(last, 400, W, PAD), PAD);
  eq("...and exactly as wide as the plot, too", readoutLeft(last, W - 2 * PAD, W, PAD), PAD);
}

console.log(failures ? `\n${failures} FAILED (${checks} checks)` : `\nALL PASS (${checks} checks)`);
process.exit(failures ? 1 : 0);
