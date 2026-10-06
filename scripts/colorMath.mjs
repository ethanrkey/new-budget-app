// Colour maths, in its own file so it can be TESTED.
//
// It lived inside validate_palette.mjs until 2026-10-06, which meant the
// gate's measuring instrument could only be exercised by running the gate —
// and the gate reports whatever the instrument says. The dichromat
// simulation was wrong for a day and the gate reported the wrong numbers
// with total confidence. Separated so tests/cvd-reference.test.mjs can
// check every function against values from a reference implementation.
//
// Everything here is pure and takes/returns "#rrggbb".

const srgb = (h) => [0, 1, 2].map((i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => {
  c = Math.max(0, Math.min(1, c));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
};
const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(gam(v) * 255).toString(16).padStart(2, "0")).join("");

// sRGB -> CIE Lab (D65), the input CIEDE2000 expects.
export const lab = (h) => labFromLinear(srgb(h).map(lin));

/**
 * Lab from LINEAR-LIGHT rgb, unclamped and unquantised.
 *
 * Measurement never goes back through "#rrggbb". A simulated colour is
 * routinely outside the sRGB gamut, and rounding it to 8 bits and clipping
 * it to [0,1] shifts ΔE by up to ~1.2 — small, but it is error introduced
 * by the instrument rather than present in the thing measured, and it was
 * enough to put three pairs outside the reference tolerance.
 */
export function labFromLinear([r, g, b]) {
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
export const deltaE2000 = (hexA, hexB) => deltaE2000Lab(lab(hexA), lab(hexB));

export function deltaE2000Lab([L1, a1, b1], [L2, a2, b2]) {

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

// ---- Dichromat simulation: Viénot, Brettel & Mollon (1999) ---------------
// The published Viénot/Brettel/Mollon RGB→RGB matrices, which operate on
// LINEAR-LIGHT sRGB. The projection onto a dichromat's plane happens in
// cone space; these matrices are that whole round trip pre-multiplied, so
// the only thing a caller has to get right is the space — and the space is
// the thing the old version got wrong.
//
// Going through LMS by hand with a different cone matrix was tried on the
// way here and drifted up to 6.7 ΔE from the reference. Using the same
// pre-multiplied matrices the reference uses removes a whole class of
// disagreement about which cone fundamentals are correct.
const VIENOT = {
  protan: [
    [0.11238276122216405, 0.8876172387778362, 0],
    [0.11238276122216398, 0.8876172387778362, 0],
    [0.0040057682730469425, -0.004005768273046939, 1],
  ],
  deutan: [
    [0.2927501142784356, 0.7072498857215644, 0],
    [0.2927501142784356, 0.7072498857215644, 0],
    [-0.022336587034129083, 0.022336587034129093, 1],
  ],
  // Viénot does not derive tritanopia; this is the paper's logic applied
  // with LMS red in place of blue, which is what every implementation
  // that offers tritan under this name does. Less trustworthy than the
  // other two, and the gate's tritan numbers should be read that way.
  tritan: [
    [1.0000000000000002, 0.1446122433069361, -0.1446122433069363],
    [0, 0.8592358078045899, 0.14076419219541025],
    [0, 0.8592358078045896, 0.14076419219541023],
  ],
};
const mul = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

/**
 * Simulate a dichromat's view of a colour. `kind` is "normal" (identity),
 * "protan", "deutan" or "tritan".
 *
 * THIS WAS WRONG UNTIL 2026-10-06 AND NOTHING HAD EVER CHECKED IT. The old
 * version applied a set of coefficients specified for GAMMA-ENCODED sRGB to
 * linearised values. It exaggerated every collapse: two Dashboard colours
 * measured ΔE2000 2.3 apart under deuteranopia when the real answer is
 * about 10.4, and that fabricated number was then used to argue for
 * relaxing the palette gate. A measuring instrument nobody measured.
 * tests/cvd-reference.test.mjs is the answer to that and runs in CI.
 */
export function simulateLinear(h, kind) {
  const linear = srgb(h).map(lin);
  return kind === "normal" ? linear : mul(VIENOT[kind], linear);
}

/** The same thing as a hex, for drawing a swatch. Clamps and quantises,
 *  which is right for a pixel and wrong for a measurement — measure with
 *  `deltaE2000Simulated`. */
export function simulate(h, kind) {
  if (kind === "normal") return h;
  const [r, g, b] = simulateLinear(h, kind);
  return hex(r, g, b);
}

/** ΔE2000 between two colours as a given dichromat sees them. */
export function deltaE2000Simulated(hexA, hexB, kind) {
  return deltaE2000Lab(labFromLinear(simulateLinear(hexA, kind)), labFromLinear(simulateLinear(hexB, kind)));
}

export const luminance = (h) => {
  const c = srgb(h).map(lin);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

