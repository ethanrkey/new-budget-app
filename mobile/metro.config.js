// Metro, pointed at the shared source OUTSIDE this project.
//
// `src/engine` is the contract between the web app and this one: the same
// money math, imported rather than reimplemented. `src/content` is the
// same idea for WORDS — the About page's sections and the tour's stops,
// so an explanation cannot go stale on one client. Three things make that
// work, and all three are load-bearing:
//
//   watchFolders       Metro only watches its own project root by default,
//                      so a file above it is invisible without this. The
//                      list is EXPLICIT rather than "../src" so that
//                      importing some other part of the web app fails
//                      loudly instead of quietly working. It is also the
//                      thing to update when a new shared directory
//                      appears: adding src/content and forgetting this
//                      typechecked clean and failed at bundle time with
//                      "unable to resolve module", which no amount of
//                      tsc would have caught.
//   nodeModulesPaths   resolve every package from mobile/node_modules and
//                      NOT from the web app's — two copies of React in one
//                      bundle is the classic way this goes wrong.
//   .ts specifiers     the engine imports carry explicit ".ts" extensions
//                      (plain Node does no TS-style resolution). Metro
//                      handles them; verified 2026-09-25 before the engine
//                      was converted, which is why this is a config file
//                      and not a rewrite.
//
// The engine is pure — no React, no network, no DOM — so nothing it imports
// can reach back into the web app's module graph. That purity is exactly
// what makes this four lines instead of a build step.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const sharedRoots = [
  path.resolve(projectRoot, "../src/engine"),
  path.resolve(projectRoot, "../src/content"),
];

const config = getDefaultConfig(projectRoot);
config.watchFolders = sharedRoots;
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
