// Every plain-node test suite, repo-root-relative. The ONE list.
//
// Two things read it and they must not disagree:
//
//   scripts/run_suites.mjs      runs them, and refuses a silent one
//   mobile/scripts/mutate.mjs   asks them "did you notice?" after
//                               breaking something
//
// They did disagree, on 2026-10-14, and it produced a confident wrong
// answer: two mutations of src/engine survived a full audit, not
// because nothing tested that code but because the thirteen checks
// that do live in tests/engine.test.mjs, which the mutation runner's
// copy of this list did not mention. It was asking "did anything
// notice" of a set that excluded the only thing watching.
export const SUITES = [
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
  "tests/dates.test.mjs",
  "tests/mobile-securestore.test.mjs",
  "tests/personal-gate.test.mjs",
  "tests/mobile-chart.test.mjs",
  "tests/calendar.test.mjs",
  "tests/mobile-fields.test.mjs",
  "tests/connect.test.mjs",
  "tests/edge-functions.test.mjs",
  "tests/web-forms.test.mjs",
];
