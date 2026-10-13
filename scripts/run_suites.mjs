// Run the plain-node suites, and refuse to believe a silent one.
//
//   node scripts/run_suites.mjs      (this is what `npm test` calls)
//
// WHY THIS EXISTS. `npm test` was a chain of `node tests/x.mjs &&
// node tests/y.mjs && ...`, which trusts an exit code. A file of
// nothing but comments exits 0. On 2026-10-14 a bad edit truncated
// tests/signin.test.mjs to its twelve-line header, and the whole run
// stayed green — 66 checks silently became zero and nothing said so.
//
// Each suite has a guard of its own for the case where it runs to the
// end having asserted almost nothing. That guard cannot help when the
// file is CUT SHORT, because the guard goes with it. So the count is
// also checked from out here, where a suite cannot delete its own
// invigilator.
//
// THE FLOOR IS DELIBERATELY LOW. It catches a file that has been
// emptied, not a file that has lost a few checks — pinning exact
// counts would mean editing this list on every real change, which is
// how a gate becomes something people route around.
import { execSync } from "node:child_process";

const MINIMUM_CHECKS = 10;

/** Every plain-node suite, in the order they ran in the old chain. */
const SUITES = [
  "tests/engine.test.mjs",
  "tests/migrations.test.mjs",
  "tests/setup.test.mjs",
  "tests/cvd-reference.test.mjs",
  "tests/mobile-edit.test.mjs",
  "tests/signin.test.mjs",
  "tests/mobile-firstrun.test.mjs",
  "tests/mobile-categories.test.mjs",
  "tests/mobile-setup.test.mjs",
  "tests/apple-secret.test.mjs",
];

let broken = 0;
let total = 0;

for (const suite of SUITES) {
  let out = "";
  let failed = false;
  try {
    out = execSync(`node ${suite} 2>&1`, { encoding: "utf8" });
  } catch (e) {
    out = e.stdout || "";
    failed = true;
  }
  process.stdout.write(out);

  // Every suite ends with "ALL PASS (N checks)". No line, no credit.
  const reported = out.match(/ALL PASS \((\d+) checks\)/);
  if (failed || !reported) {
    console.log(`\n>> ${suite} DID NOT PASS`);
    broken++;
    continue;
  }
  const checks = Number(reported[1]);
  if (checks < MINIMUM_CHECKS) {
    console.log(`\n>> ${suite} reported only ${checks} checks — truncated, or stopped early`);
    broken++;
    continue;
  }
  total += checks;
}

console.log(
  broken === 0
    ? `\n${SUITES.length} suites, ${total} checks, all passing`
    : `\n${broken} SUITE(S) NOT OK`
);
process.exit(broken === 0 ? 0 : 1);
