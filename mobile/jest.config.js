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
  // The engine lives ABOVE this package (../src/engine) and is compiled by
  // babel here, but it resolves its runtime helpers from its own directory
  // and finds nothing — the repo root has no node_modules. Metro solves the
  // same problem with nodeModulesPaths; this is that, for jest.
  moduleNameMapper: {
    "^@babel/runtime/(.*)$": "<rootDir>/node_modules/@babel/runtime/$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg))",
  ],
};
