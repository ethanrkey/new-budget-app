// Palette gate. Runs in CI, not when someone remembers.
//
//   node scripts/validate_palette.mjs
//
// The old 8-hue palette shipped a Blue/Indigo pair that was indistinguishable
// under deuteranopia, and it survived for months because the check was a
// script nobody re-ran after the palette changed. That is the actual lesson:
// a validated palette is not a property of the colors, it is a property of
// the process. So this exits non-zero.
//
// Rewritten 2026-10-06 for the brass/card system. The role palette it used
// to check no longer exists — color stopped encoding role, so there is no
// semantic hue-family rule left to enforce.
//
// Thresholds are the designer's, enforced under NORMAL, PROTAN, DEUTAN and
// TRITAN, with no exemptions. An earlier version of this file carved out
// exemptions for the ramp and the cards on the argument that only
// meaning-bearing color needs a CVD floor. The argument was reasonable;
// the numbers that motivated it were not. `simulate()` was broken (see
// colorMath.mjs), reporting collapses three to four times worse than real,
// and the "relaxation" was invented to accommodate a bug. The palette
// passes the specified thresholds as specified, and that is the end of it.
//
// THE MEASURING INSTRUMENT IS ITSELF MEASURED. tests/cvd-reference.test.mjs
// checks every pair here against coloraide 8.13 and runs in `npm test`.
// Before trusting a number this file prints, know that something checked
// the thing that produced it.
import { BRASS_RAMP, CARD_COLORS, BAR_COLOR, NEUTRAL_CHART, NEUTRAL_LINE } from "../src/engine/palette.ts";
import { deltaE2000Simulated, contrast, lab } from "./colorMath.mjs";

const RAMP_MIN = 8.0;  // adjacent steps of the brass ramp, worst vision type
const CARD_MIN = 9.0;  // every pair of card colors, worst vision type
const MIN_CONTRAST = 3;

// Direction. Not imported from palette.ts because these are Tailwind theme
// tokens (`text-income` / `text-expense`) — the gate reads them here so a
// change to tailwind.config.js cannot slip past it unmeasured.
const DIRECTION = { income: "#0B7A0B", expense: "#C0392B" };

// The surfaces these are actually drawn on, from the app's own Tailwind
// tokens — the card (gray-900 / white) and the page behind it (gray-950 /
// gray-50). Both are checked: a chart sits on a card, a dot beside a label
// can sit on either.
const SURFACES = {
  dark: { card: "#111827", page: "#030712" },
  light: { card: "#ffffff", page: "#f9fafb" },
};

const VISION = ["normal", "protan", "deutan", "tritan"];

let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`PASS  ${msg}`);

/** Worst ΔE2000 for one pair across every vision type, and which one. */
function worst(a, b) {
  let w = [Infinity, ""];
  for (const v of VISION) {
    const d = deltaE2000Simulated(a, b, v);
    if (d < w[0]) w = [d, v];
  }
  return w;
}
const lightness = (h) => lab(h)[0];

for (const mode of ["dark", "light"]) {
  console.log(`\n== ${mode} ==`);

  // ---- 1. The brass ramp, adjacent pairs, enforced under all four.
  const ramp = BRASS_RAMP[mode];
  let rampWorst = [Infinity, ""];
  for (let i = 0; i + 1 < ramp.length; i++) {
    const [d, v] = worst(ramp[i], ramp[i + 1]);
    if (d < rampWorst[0]) rampWorst = [d, `step ${i + 1}/${i + 2} (${v})`];
    if (d < RAMP_MIN) fail(`${mode} brass step ${i + 1}/${i + 2}: ΔE2000 ${d.toFixed(1)} under ${v} — below ${RAMP_MIN}`);
  }
  if (rampWorst[0] >= RAMP_MIN) ok(`brass ramp, worst adjacent pair ΔE2000 ${rampWorst[0].toFixed(1)} — ${rampWorst[1]}`);

  // An additional assertion, not a substitute for the one above: a ramp is
  // read in ORDER, and L* is the one channel no dichromacy touches, so
  // monotonic lightness is what guarantees the order survives for every
  // reader even if a pair ever scrapes the floor.
  const L = ramp.map(lightness);
  const up = L.every((v, i) => i === 0 || v > L[i - 1]);
  const down = L.every((v, i) => i === 0 || v < L[i - 1]);
  if (!up && !down) fail(`${mode} brass ramp lightness is not monotonic: ${L.map((v) => v.toFixed(1)).join(" → ")}`);
  else ok(`brass ramp runs ${up ? "dark → light" : "light → dark"} in L*: ${L.map((v) => v.toFixed(1)).join(" → ")}`);

  // ---- 2. The card set, EVERY pair: the order is the user's accounts'.
  const cards = CARD_COLORS[mode];
  let cardWorst = [Infinity, ""];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const [d, v] = worst(cards[i], cards[j]);
      if (d < cardWorst[0]) cardWorst = [d, `${cards[i]}/${cards[j]} (${v})`];
      if (d < CARD_MIN) fail(`${mode} cards ${cards[i]}/${cards[j]}: ΔE2000 ${d.toFixed(1)} under ${v} — below ${CARD_MIN}`);
    }
  }
  if (cardWorst[0] >= CARD_MIN) ok(`card set, worst of all pairs ΔE2000 ${cardWorst[0].toFixed(1)} — ${cardWorst[1]}`);

  // ---- 3. Contrast, on both surfaces a mark can land on.
  const marks = [
    ...ramp.map((h, i) => [`brass ${i + 1}`, h]),
    ["bar", BAR_COLOR[mode]],
    ["neutral/Other/loan", NEUTRAL_CHART],
    ["checking line", NEUTRAL_LINE[mode]],
    ...cards.map((h, i) => [`card ${i + 1}`, h]),
    ["income", DIRECTION.income],
    ["expense", DIRECTION.expense],
  ];
  let lowest = [Infinity, ""];
  for (const [name, h] of marks) {
    for (const [where, surface] of Object.entries(SURFACES[mode])) {
      const c = contrast(h, surface);
      if (c < lowest[0]) lowest = [c, `${name} on ${where}`];
      if (c < MIN_CONTRAST) fail(`${mode} ${name} (${h}) is ${c.toFixed(2)}:1 on the ${where} — need ${MIN_CONTRAST}`);
    }
  }
  if (lowest[0] >= MIN_CONTRAST) ok(`contrast, lowest ${lowest[0].toFixed(2)}:1 — ${lowest[1]}`);

  // ---- 4. Direction, reported. Red/green is the only meaning-bearing
  //         color left and a protanope cannot separate it; it is legal
  //         only because the sign, the column and the label repeat it.
  const [dirD, dirV] = worst(DIRECTION.income, DIRECTION.expense);
  console.log(`      income/expense measure ΔE2000 ${dirD.toFixed(1)} under ${dirV} — legal only because color never carries it alone`);
}

console.log(failures === 0 ? "\nPALETTE OK" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
