// The measuring instrument, measured.
//
//   node tests/cvd-reference.test.mjs     (runs in `npm test`, so in CI)
//
// WHY THIS EXISTS. On 2026-10-06 the palette gate reported that two
// Dashboard colors were ΔE2000 2.3 apart under deuteranopia — close enough
// to be indistinguishable. The real answer is about 10.4. The gate's
// dichromat simulation was applying a set of RGB→RGB coefficients
// specified for GAMMA-ENCODED sRGB to linearized values, and nothing had
// ever checked it against a known answer, so it reported a fabricated
// number with complete confidence and a design decision was very nearly
// built on it.
//
// A checker is a program. It gets the same treatment as any other program:
// run it against answers obtained some other way, and fail when it drifts.
//
// THE REFERENCE. `cvd-reference.json` holds every pair the gate measures,
// with ΔE2000 under normal vision and under protanopia, deuteranopia and
// tritanopia as computed by coloraide 8.13 — three independent simulation
// models each (Brettel 1997, Viénot 1999, Machado 2009). Regenerating it
// needs coloraide; the file records how.
//
// WHAT IS ASSERTED, and why two different tolerances:
//
//   vs. VIÉNOT — tight (0.05, and we currently sit at 0.00). The gate uses
//   the same pre-multiplied Viénot matrices coloraide does, so this is the
//   implementation compared with itself in another codebase. Any gap is a
//   bug, not a difference of opinion.
//
//   vs. THE SPREAD — loose. The three models genuinely disagree (one pair
//   here: 10.4 / 11.0 / 10.9), so the honest second assertion is that our
//   number sits inside their range, widened by 1.0. This catches a value
//   that happens to match Viénot's arithmetic while being wrong about the
//   world.
import { readFileSync } from "node:fs";
import { deltaE2000, deltaE2000Simulated, simulate } from "../scripts/colorMath.mjs";

const ref = JSON.parse(readFileSync(new URL("./cvd-reference.json", import.meta.url), "utf8"));

// 0.05, because after the fix we agree with coloraide to 0.00 across all
// 141 comparisons — same algorithm, same pre-multiplied matrices, and the
// measurement never round-trips through 8-bit hex. A tolerance set loose
// enough to absorb a real bug is not a check.
const VIENOT_TOL = 0.05;
const SPREAD_PAD = 1.0;
const KINDS = ["protan", "deutan", "tritan"];

let failures = 0;
let checks = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };

// ---- 1. Normal vision: ΔE2000 itself, with no simulation in the way.
let worstNormal = 0;
for (const { a, b, normal } of ref.pairs) {
  checks++;
  const got = deltaE2000(a, b);
  const gap = Math.abs(got - normal);
  if (gap > worstNormal) worstNormal = gap;
  if (gap > 0.1) fail(`ΔE2000 ${a}/${b}: ${got.toFixed(2)} vs reference ${normal} (off by ${gap.toFixed(2)})`);
}
console.log(`PASS  ΔE2000 matches the reference on ${ref.pairs.length} pairs — worst gap ${worstNormal.toFixed(3)}`);

// ---- 2. Each dichromacy, against Viénot and against the spread.
for (const kind of KINDS) {
  let worstVienot = 0, worstVienotPair = "";
  let outside = 0;
  for (const row of ref.pairs) {
    checks++;
    const got = deltaE2000Simulated(row.a, row.b, kind);
    const models = row[kind];

    const gap = Math.abs(got - models.vienot);
    if (gap > worstVienot) { worstVienot = gap; worstVienotPair = `${row.a}/${row.b}`; }
    if (gap > VIENOT_TOL) {
      fail(`${kind} ${row.a}/${row.b}: ${got.toFixed(2)} vs coloraide vienot ${models.vienot} (off by ${gap.toFixed(2)})`);
    }

    const all = [models.brettel, models.vienot, models.machado];
    const lo = Math.min(...all) - SPREAD_PAD;
    const hi = Math.max(...all) + SPREAD_PAD;
    if (got < lo || got > hi) {
      outside++;
      fail(`${kind} ${row.a}/${row.b}: ${got.toFixed(2)} is outside [${lo.toFixed(2)}, ${hi.toFixed(2)}] — the three models say ${all.join(" / ")}`);
    }
  }
  if (worstVienot <= VIENOT_TOL && outside === 0) {
    console.log(`PASS  ${kind}: within ${worstVienot.toFixed(2)} of coloraide's vienot (worst: ${worstVienotPair}), and inside every model spread`);
  }
}

// ---- 3. Spot values that are wrong in an OBVIOUS way if the pipeline is.
// A protanope and a deuteranope both see pure red as a dark yellow with the
// red and green channels equal — that equality is the signature of the
// projection, and it survives any reasonable model. Tritanopia leaves red
// essentially alone. If the matrix is applied in the wrong space these stop
// holding before any ΔE is involved.
const chan = (h) => [0, 1, 2].map((i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16));
for (const kind of ["protan", "deutan"]) {
  checks++;
  const [r, g, b] = chan(simulate("#ff0000", kind));
  if (Math.abs(r - g) > 12) fail(`${kind} should make pure red's R and G equal, got ${simulate("#ff0000", kind)}`);
  else if (b > 40) fail(`${kind} on pure red should leave almost no blue, got ${simulate("#ff0000", kind)}`);
  else console.log(`PASS  ${kind} turns #ff0000 into ${simulate("#ff0000", kind)} — R≈G, no blue`);
}
checks++;
if (deltaE2000("#ff0000", simulate("#ff0000", "tritan")) > 6) {
  fail(`tritan should barely move pure red, got ${simulate("#ff0000", "tritan")}`);
} else {
  console.log(`PASS  tritan leaves #ff0000 near itself (${simulate("#ff0000", "tritan")})`);
}

// ---- 4. Prove the harness can fail. A check that has never gone red is a
// claim, and this whole file exists because of one of those.
{
  const bogus = (h) => h; // a "simulation" that does nothing at all
  const row = ref.pairs.find((p) => Math.abs(p.normal - p.deutan.vienot) > 3);
  const got = deltaE2000(bogus(row.a), bogus(row.b));
  if (Math.abs(got - row.deutan.vienot) <= VIENOT_TOL) {
    fail("the no-op simulation passed the deutan tolerance — this test cannot detect a broken simulate()");
  } else {
    console.log(`PASS  a no-op simulation is caught (${row.a}/${row.b}: ${got.toFixed(1)} vs ${row.deutan.vienot})`);
  }
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
