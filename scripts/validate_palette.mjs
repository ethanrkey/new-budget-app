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
import { ACCOUNT_HUES, LOAN_COLOR, SPENDING_COLOR, DEGRADED_SOLID, NEUTRAL_CHART, NEUTRAL_LINE } from "../src/engine/palette.ts";
import { deltaE2000Simulated, contrast, lab } from "./colorMath.mjs";

// Every chart fill can appear beside every other, so there are no
// "adjacent only" pairs left to exempt — the brass ramp that needed that
// rule went with the pie.
const FILL_MIN = 9.0;
const MIN_CONTRAST = 3;

// Direction. Not imported from palette.ts because these are Tailwind theme
// tokens (`text-income` / `text-expense`) — the gate reads them here so a
// change to tailwind.config.js cannot slip past it unmeasured.
// BOTH CLIENTS' reds, because both are "the expense red" to the person
// looking at them — the web's Tailwind token and the phone's theme. A
// hue vetted against only one of them is vetted for only one client,
// which is how an account color came within ΔE 1.7 of red on the phone.
const DIRECTION = { income: "#0B7A0B", expense: "#C0392B" };
// Keyed by the MODE each can actually appear in. The web renders both
// modes with the Tailwind token; the phone is dark-only by decision, so
// its red never sits beside a light-mode fill and holding light colors to
// it would be inventing a constraint. Over-strict is not the same as
// careful: it would have sent me re-picking a color that is fine.
const EXPENSE_REDS = {
  dark: { web: "#C0392B", phone: "#f87171" },
  light: { web: "#C0392B" },
};

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

  // The whole fill set: eight account hues plus the three fixed roles and
  // the degraded neutral. ALL PAIRS, because a chart can hold any of them
  // at once and a sorted list puts any two side by side.
  const fills = [
    ...ACCOUNT_HUES[mode].map((h, i) => [`account ${i}`, h]),
    ["loan", LOAN_COLOR[mode]],
    ["spending", SPENDING_COLOR[mode]],
    ["other", NEUTRAL_CHART],
    ["degraded", DEGRADED_SOLID[mode]],
  ];
  let fillWorst = [Infinity, ""];
  for (let i = 0; i < fills.length; i++) {
    for (let j = i + 1; j < fills.length; j++) {
      const [d, v] = worst(fills[i][1], fills[j][1]);
      if (d < fillWorst[0]) fillWorst = [d, `${fills[i][0]}/${fills[j][0]} (${v})`];
      if (d < FILL_MIN) fail(`${mode} ${fills[i][0]}/${fills[j][0]}: ΔE2000 ${d.toFixed(1)} under ${v} — below ${FILL_MIN}`);
    }
  }
  if (fillWorst[0] >= FILL_MIN) ok(`${fills.length} chart fills, worst of ALL pairs ΔE2000 ${fillWorst[0].toFixed(1)} — ${fillWorst[1]}`);

  // An account hue must never be mistaken for the direction red — red is
  // the only color in this app that means something on its own.
  // A PASS printed right after a FAIL for the same check is a lying
  // checker, so this counts before it claims.
  let redClashes = 0;
  for (const [name, hex] of fills) {
    for (const [client, red] of Object.entries(EXPENSE_REDS[mode])) {
      const [d, v] = worst(hex, red);
      if (d < FILL_MIN) { redClashes++; fail(`${mode} ${name} is ΔE2000 ${d.toFixed(1)} from the ${client} expense red under ${v}`); }
    }
  }
  if (redClashes === 0) ok("no fill collides with the direction red");

  // Contrast, on both surfaces a mark can land on.
  const marks = [...fills, ["checking line", NEUTRAL_LINE[mode]], ["income", DIRECTION.income], ["expense", DIRECTION.expense]];
  let lowest = [Infinity, ""];
  for (const [name, h] of marks) {
    for (const [where, surface] of Object.entries(SURFACES[mode])) {
      const c = contrast(h, surface);
      if (c < lowest[0]) lowest = [c, `${name} on ${where}`];
      if (c < MIN_CONTRAST) fail(`${mode} ${name} (${h}) is ${c.toFixed(2)}:1 on the ${where} — need ${MIN_CONTRAST}`);
    }
  }
  if (lowest[0] >= MIN_CONTRAST) ok(`contrast, lowest ${lowest[0].toFixed(2)}:1 — ${lowest[1]}`);

  const [dirD, dirV] = worst(DIRECTION.income, DIRECTION.expense);
  console.log(`      income/expense measure ΔE2000 ${dirD.toFixed(1)} under ${dirV} — legal only because color never carries it alone`);
}

console.log(failures === 0 ? "\nPALETTE OK" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
