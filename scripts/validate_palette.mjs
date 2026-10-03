// Palette gate. Runs in CI, not when someone remembers.
//
//   node scripts/validate_palette.mjs
//
// The old 8-hue palette shipped a Blue/Indigo pair at ΔE 1.3 under
// deuteranopia — identical, not merely tight — and it survived for months
// because the check was a script nobody re-ran after the palette changed.
// That is the actual lesson: a validated palette is not a property of the
// colours, it is a property of the process. So this exits non-zero.
//
// What it checks, for every mode and every pair (ALL pairs, never just
// adjacent ones — any view that sorts by value can put any two side by
// side, which is the rule in PROJECT_SPEC §7):
//
//   1. separation under normal vision, deuteranopia, protanopia, tritanopia
//   2. contrast against that mode's surface, so a swatch is visible at all
//   3. no role hue colliding with another role's
//
// ΔE is OKLab ×100. The thresholds are the spec's: 8 is the target, 6-8 is
// a floor legal only with secondary encoding (every slice carries an inline
// label, so the floor is defensible), under 6 is a failure.
import { ROLE_COLORS, ROLE_ORDER, ROLE_HUE, SEMANTIC_FAMILY } from "../src/engine/palette.ts";

const TARGET = 8;
const FLOOR = 6;
const SURFACE = { light: "#f9fafb", dark: "#030712" };
const MIN_CONTRAST = 3; // WCAG 1.4.11 for non-text UI components

const srgb = (h) => [0, 1, 2].map((i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => {
  c = Math.max(0, Math.min(1, c));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
};
const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(gam(v) * 255).toString(16).padStart(2, "0")).join("");

function oklab(h) {
  const [r, g, b] = srgb(h).map(lin);
  const l = Math.cbrt(0.4122 * r + 0.5363 * g + 0.0514 * b);
  const m = Math.cbrt(0.2119 * r + 0.6807 * g + 0.1074 * b);
  const s = Math.cbrt(0.0883 * r + 0.2817 * g + 0.6300 * b);
  return [0.2105 * l + 0.7936 * m - 0.0041 * s, 1.9780 * l - 2.4286 * m + 0.4506 * s, 0.0259 * l + 0.7828 * m - 0.8087 * s];
}
const deltaE = (a, b) => {
  const A = oklab(a), B = oklab(b);
  return Math.hypot(...[0, 1, 2].map((i) => (A[i] - B[i]) * 100));
};

// Brettel-style linear approximations. Good enough to catch a 1.3, which is
// the failure that actually shipped; not a substitute for a real observer.
function simulate(h, kind) {
  const [r, g, b] = srgb(h).map(lin);
  if (kind === "normal") return h;
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

// SEMANTIC DISTANCE, checked BEFORE the colour maths — this is the
// constraint that was missing. Two roles in different families must be in
// different hue families too, or you get bills and savings as two blues:
// separable by measurement and wrong by meaning. Within a family no hue
// rule applies, because siblings SHOULD look related.
const MIN_CROSS_FAMILY_HUE = 60;

let failures = 0, warnings = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };
const warn = (msg) => { warnings++; console.log(`WARN  ${msg}`); };

console.log("== semantic families ==");
for (let i = 0; i < ROLE_ORDER.length; i++) {
  for (let j = i + 1; j < ROLE_ORDER.length; j++) {
    const a = ROLE_ORDER[i], b = ROLE_ORDER[j];
    if (SEMANTIC_FAMILY[a] === SEMANTIC_FAMILY[b]) continue;
    const ha = ROLE_HUE[a], hb = ROLE_HUE[b];
    if (ha == null || hb == null) continue; // grey has no hue by design
    const d = Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb));
    if (d < MIN_CROSS_FAMILY_HUE) {
      failures++;
      console.log(`FAIL  ${a} (${SEMANTIC_FAMILY[a]}) and ${b} (${SEMANTIC_FAMILY[b]}) are ${d}° apart — different meanings must not share a hue family`);
    }
  }
}
if (failures === 0) console.log("PASS  every cross-family pair is >= " + MIN_CROSS_FAMILY_HUE + "° apart in hue");

for (const mode of ["light", "dark"]) {
  console.log(`\n== ${mode} ==`);

  for (const role of ROLE_ORDER) {
    const c = contrast(ROLE_COLORS[role][mode], SURFACE[mode]);
    if (c < MIN_CONTRAST) fail(`${role} is ${c.toFixed(1)}:1 on the ${mode} surface (need ${MIN_CONTRAST})`);
  }

  for (const vision of ["normal", "deutan", "protan", "tritan"]) {
    let worst = [Infinity, ""];
    for (let i = 0; i < ROLE_ORDER.length; i++) {
      for (let j = i + 1; j < ROLE_ORDER.length; j++) {
        const a = ROLE_COLORS[ROLE_ORDER[i]][mode], b = ROLE_COLORS[ROLE_ORDER[j]][mode];
        const d = deltaE(simulate(a, vision), simulate(b, vision));
        const label = `${ROLE_ORDER[i]}/${ROLE_ORDER[j]}`;
        if (d < worst[0]) worst = [d, label];
        if (d < FLOOR) fail(`${vision}: ${label} ΔE ${d.toFixed(1)} — below the ${FLOOR} floor`);
      }
    }
    const [d, label] = worst;
    const verdict = d >= TARGET ? "PASS" : d >= FLOOR ? "FLOOR" : "FAIL";
    if (verdict === "FLOOR") warn(`${vision}: worst pair ${label} ΔE ${d.toFixed(1)} — legal only because every slice carries an inline label`);
    else console.log(`${verdict}  ${vision}: worst pair ${label} ΔE ${d.toFixed(1)}`);
  }
}

console.log(
  failures === 0
    ? `\nPALETTE OK${warnings ? ` (${warnings} at the floor)` : ""}`
    : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
