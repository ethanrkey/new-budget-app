// The renderer the plain-node harness cannot have.
//
// `tests/mobile-edit.test.mjs` covers the wiring with no React in it, which
// is what makes it fast and framework-free — and is exactly why it passed
// 57 assertions while the editor sheet never opened. Twice in two days a
// passing count implied coverage it did not have: a form verified
// standalone while its routing was not, then a scope sheet whose logic was
// right and whose presentation was swallowed.
//
// So this is deliberately NOT a second place to test logic. Anything that
// can be asserted without a renderer belongs in tests/mobile-edit.test.mjs,
// where it runs in milliseconds. What belongs here is the half that only
// exists once components are mounted: does pressing the thing open the
// thing, is the control disabled when it should be, does the handler get
// called with what the screen was showing.
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/__tests__/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/__tests__/setup.ts"],
  // 20s, not jest's 5s default. CI run 41223203802 (2026-10-31) failed
  // "it opens on the first question and counts the rest" with
  // "Exceeded timeout of 5000 ms": the first test of the slowest suite
  // pays for the first mount, and userEvent.type is slow on a shared
  // runner. Nothing was wrong with it. Locally the heaviest tests, in
  // setupflow AND chrome, take ~2s, so on a runner 2-3x slower several
  // sit near 5s. One limit for every suite, so the next slow suite
  // doesn't fail the same way. A test that really hangs still fails,
  // just after 20s instead of 5.
  testTimeout: 20000,
  // The engine lives ABOVE this package (../src/engine) and is compiled by
  // babel here, but it resolves its runtime helpers from its own directory
  // and finds nothing — the repo root has no node_modules. Metro solves the
  // same problem with nodeModulesPaths; this is that, for jest.
  moduleNameMapper: {
    "^@babel/runtime/(.*)$": "<rootDir>/node_modules/@babel/runtime/$1",
  },
  // `standard-navigation` ships ESM and is pulled in by expo-router,
  // which Chrome reaches through Tour. Without it here, mounting the
  // app's own shell fails to PARSE — which reads as a broken test
  // rather than as a missing transform.
  transformIgnorePatterns: [
    "node_modules/(?!(standard-navigation|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg))",
  ],
};
