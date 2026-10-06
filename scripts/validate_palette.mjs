// Palette gate. Runs in CI, not when someone remembers.
//
//   node scripts/validate_palette.mjs
//
// The old 8-hue palette shipped a Blue/Indigo pair that was indistinguishable
// under deuteranopia, and it survived for months because the check was a
// script nobody re-ran after the palette changed. That is the actual lesson:
// a validated palette is not a property of the colours, it is a property of
// the process. So this exits non-zero.
//
// Rewritten 2026-10-06 for the brass/card system. The role palette it used to
// check no longer exists — colour stopped encoding role, so there is no
// all-pairs hue separation to enforce and no semantic hue families to defend.
//
// WHICH COLOURS GET A CVD FLOOR, AND WHY NOT ALL OF THEM. The old gate held
// every colour to a colour-vision-deficiency floor because every colour
// carried meaning: a hue WAS the category, so a reader who could not
// separate two hues could not read the chart. That is no longer true of
// anything except red and green.
//
//   DIRECTION (income green, expense red) is the only meaning-bearing
//   colour left, so it carries the CVD floor — and it is also the classic
//   red/green pair, which is exactly the one a protanope or deuteranope
//   cannot separate. It survives because it never stands alone: the sign,
//   the column and the label all say the same thing. The floor here is on
//   CONTRAST, with the ΔE reported so the pair is never silently worsened.
//
//   THE BRASS RAMP is one hue separated by LIGHTNESS, and lightness is the
//   one channel no dichromacy touches. Simulating a dichromat compresses
//   chroma, which drags ΔE2000 down even when the steps stay perfectly
//   ordered — the light ramp measures 9.1 under normal vision and 6.7 under
//   tritan while reading as four clean steps either way. So the ramp is
//   gated on normal-vision ΔE plus STRICTLY MONOTONIC L*, which is the
//   property that actually has to hold.
//
//   CARD COLOURS are decoration. The hue says nothing — it is assigned by
//   card position — so two cards a deuteranope reads as one shade of blue
//   lose a scanning aid and mislead nobody; the card is labelled and the
//   number is on it. They are gated on normal-vision separation (the job
//   is "five distinguishable objects for most readers") and on contrast
//   (which everyone needs). Their CVD numbers are printed, not enforced.
//
// This distinction is the whole design of the gate and it is reversible in
// one constant each. If card colour ever starts meaning something, move it
// into MEANING and re-pick: measured 2026-10-06, the light set's sky and
// indigo are ΔE2000 2.3 apart under deuteranopia and could not carry it.
//
// MEASURED IN ΔE2000, not OKLab distance. The old gate used OKLab ×100,
// which is fine for ranking but is not the number anyone else quotes.
import { BRASS_RAMP, CARD_COLORS, BAR_COLOR, NEUTRAL_CHART, NEUTRAL_LINE } from "../src/engine/palette.ts";

const RAMP_MIN = 8.0;  // adjacent steps of the brass ramp, normal vision
const CARD_MIN = 9.0;  // every pair of card colours, normal vision
const MIN_CONTRAST = 3;

// Direction. Not imported from palette.ts because these are Tailwind theme
// tokens (`text-income` / `text-expense`) — the gate reads them here so a
// change to tailwind.config.js cannot slip past it unmeasured.
const DIRECTION = { income: "#0B7A0B", expense: "#C0392B" };

// The surfaces these are actually drawn on, from the app's own Tailwind
// tokens — the card (gray-900 / white) and the page behind it (gray-950 /
// gray-50). Both are checked: a chart sits on a card, a dot beside a label
// can sit on either. The hand-measured values that these colours were
// picked against (#121826 / #040711) differ from the tokens by rounding;
// checking the tokens is checking what ships.
const SURFACES = {
  dark: { card: "#111827", page: "#030712" },
  light: { card: "#ffffff", page: "#f9fafb" },
};

// ---- colour maths --------------------------------------------------------

const srgb = (h) => [0, 1, 2].map((i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => {
  c = Math.max(0, Math.min(1, c));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
};
const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(gam(v) * 255).toString(16).padStart(2, "0")).join("");

// sRGB -> CIE Lab (D65), the input CIEDE2000 expects.
function lab(h) {
  const [r, g, b] = srgb(h).map(lin);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.0;
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** CIEDE2000. The reference formula, written out rather than approximated —
 *  the thresholds in this file are quoted in it and have to mean what
 *  everyone else means. */
function deltaE2000(hexA, hexB) {
  const [L1, a1, b1] = lab(hexA);
  const [L2, a2, b2] = lab(hexB);

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  const hp = (bb, aa) => {
    if (aa === 0 && bb === 0) return 0;
    const h = deg(Math.atan2(bb, aa));
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(b1, a1p);
  const h2p = hp(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else {
    const d = h2p - h1p;
    dhp = d > 180 ? d - 360 : d < -180 ? d + 360 : d;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));

  const Lbar = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.20 * Math.cos(rad(4 * hbarp - 63));

  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;

  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)
  );
}

// Brettel-style linear approximations. Good enough to catch the kind of
// collapse that actually shipped; not a substitute for a real observer.
function simulate(h, kind) {
  if (kind === "normal") return h;
  const [r, g, b] = srgb(h).map(lin);
  if (kind === "deutan") return hex(0.625 * r + 0.375 * g, 0.70 * r + 0.30 * g, 0.30 * g + 0.70 * b);
  if (kind === "protan") return hex(0.567 * r + 0.433 * g, 0.558 * r + 0.442 * g, 0.242 * g + 0.758 * b);
  return hex(0.95 * r + 0.05 * g, 0.433 * g + 0.567 * b, 0.475 * g + 0.525 * b); // tritan
}

const luminance = (h) => {
  const c = srgb(h).map(lin);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const VISION = ["normal", "protan", "deutan", "tritan"];
const CVD = ["protan", "deutan", "tritan"];

let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`PASS  ${msg}`);
const info = (msg) => console.log(`      ${msg}`);

/** Worst ΔE2000 over a set of vision types, for one pair. */
function worst(a, b, kinds) {
  let w = [Infinity, ""];
  for (const v of kinds) {
    const d = deltaE2000(simulate(a, v), simulate(b, v));
    if (d < w[0]) w = [d, v];
  }
  return w;
}
const lightness = (h) => lab(h)[0];

for (const mode of ["dark", "light"]) {
  console.log(`\n== ${mode} ==`);

  // ---- 1. The brass ramp: neighbours, and the ordering that survives CVD.
  const ramp = BRASS_RAMP[mode];
  let rampWorst = [Infinity, ""], rampCvd = [Infinity, ""];
  for (let i = 0; i + 1 < ramp.length; i++) {
    const [d] = worst(ramp[i], ramp[i + 1], ["normal"]);
    if (d < rampWorst[0]) rampWorst = [d, `step ${i + 1}/${i + 2}`];
    if (d < RAMP_MIN) fail(`${mode} brass step ${i + 1}/${i + 2}: ΔE2000 ${d.toFixed(1)} — below ${RAMP_MIN}`);
    const [c, v] = worst(ramp[i], ramp[i + 1], CVD);
    if (c < rampCvd[0]) rampCvd = [c, `step ${i + 1}/${i + 2} (${v})`];
  }
  // The property that actually has to hold: a ramp read in order. No
  // dichromacy alters L*, so monotonic lightness means the steps stay in
  // order for every reader, whatever the simulated ΔE says.
  const L = ramp.map(lightness);
  const up = L.every((v, i) => i === 0 || v > L[i - 1]);
  const down = L.every((v, i) => i === 0 || v < L[i - 1]);
  if (!up && !down) fail(`${mode} brass ramp lightness is not monotonic: ${L.map((v) => v.toFixed(1)).join(" → ")}`);
  else ok(`brass ramp runs ${up ? "dark → light" : "light → dark"} in L*: ${L.map((v) => v.toFixed(1)).join(" → ")}`);
  if (rampWorst[0] >= RAMP_MIN) ok(`brass ramp, worst adjacent pair ΔE2000 ${rampWorst[0].toFixed(1)} — ${rampWorst[1]}`);
  info(`under CVD the same pair measures ${rampCvd[0].toFixed(1)} — ${rampCvd[1]}; chroma collapses, the lightness order does not`);

  // ---- 2. The card set: every pair, because the order is the user's.
  const cards = CARD_COLORS[mode];
  let cardWorst = [Infinity, ""], cardCvd = [Infinity, ""];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const [d] = worst(cards[i], cards[j], ["normal"]);
      if (d < cardWorst[0]) cardWorst = [d, `${cards[i]}/${cards[j]}`];
      if (d < CARD_MIN) fail(`${mode} cards ${cards[i]}/${cards[j]}: ΔE2000 ${d.toFixed(1)} — below ${CARD_MIN}`);
      const [c, v] = worst(cards[i], cards[j], CVD);
      if (c < cardCvd[0]) cardCvd = [c, `${cards[i]}/${cards[j]} (${v})`];
    }
  }
  if (cardWorst[0] >= CARD_MIN) ok(`card set, worst of all pairs ΔE2000 ${cardWorst[0].toFixed(1)} — ${cardWorst[1]}`);
  info(`under CVD the worst card pair is ${cardCvd[0].toFixed(1)} — ${cardCvd[1]}; decoration, so reported not enforced`);

  // ---- 3. Direction: the only meaning-bearing colour left.
  const [dirCvd, dirV] = worst(DIRECTION.income, DIRECTION.expense, CVD);
  info(`income/expense measure ${dirCvd.toFixed(1)} under ${dirV} — never stands alone (sign, column and label all repeat it)`);

  // ---- 4. Contrast, on both surfaces a mark can land on.
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
}

console.log(failures === 0 ? "\nPALETTE OK" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
