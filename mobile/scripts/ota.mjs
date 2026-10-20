// ---- The only way an OTA goes out ----
//
// Publishing used to be a command typed from memory, and the memory
// was wrong three times in three different ways:
//
//   - `npx eas update` is not the CLI (it is `eas-cli`);
//   - `--non-interactive` needs `--environment production` or it
//     refuses;
//   - with an environment set the export runs `--platform=all`, and
//     the WEB bundle fails on a `@radix-ui/react-tabs` this iOS-only
//     client does not install. `--platform ios` or no update ships.
//
// And the one that matters more than all three: an OTA is built from
// the WORKING TREE, not from a commit. A publish with a dirty tree
// ships whatever happens to be on disk — including, twice now, a file
// left mutated by an interrupted `scripts/mutate.mjs` run. The commit
// hash printed on the update would have been a lie about what the
// update contains.
//
// So this script refuses to publish unless the tree is clean, HEAD is
// pushed, and the fingerprint is the runtime the owner named.
//
//   node scripts/ota.mjs --runtime <hash> --message "what changed"
//   node scripts/ota.mjs --runtime <hash> --message "..." --dry-run
//
// Run it from mobile/ — the fingerprint command only answers there.
import { execSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const has = (name) => argv.includes(name);

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const die = (...lines) => { lines.forEach((l) => console.log(l)); process.exit(1); };

const message = flag("--message");
const runtime = flag("--runtime");
if (!message) die("--message is required: it is what the owner reads in the dashboard six weeks from now.");
if (!runtime && !has("--any-runtime")) {
  die("--runtime <hash> is required.",
      "An update published to the wrong runtime installs on nothing and says it succeeded.",
      "Pass --any-runtime only if you genuinely mean 'whatever this tree fingerprints to'.");
}

// 1. A CLEAN TREE. The whole reason this file exists.
const dirty = sh("git -C .. status --porcelain");
if (dirty) {
  die("THE TREE IS NOT CLEAN. An OTA ships the working tree, so this would publish these:",
      "", dirty, "",
      "Commit them, stash them, or `git checkout --` them. If any of them is a file you did",
      "not edit, check `scripts/mutate.mjs` did not leave it behind.");
}

// 2. HEAD IS PUSHED. The update records a commit hash; a hash only on
// this laptop makes the record unverifiable by anyone, later including
// me.
let ahead = "0";
try { ahead = sh("git -C .. rev-list --count @{u}..HEAD"); }
catch { die("No upstream branch — push first, so the commit this update names exists somewhere else."); }
if (ahead !== "0") die(`HEAD is ${ahead} commit(s) ahead of the remote. Push first.`);

// 3. THE FINGERPRINT IS THE RUNTIME THE OWNER NAMED. A mismatch means
// native inputs moved and this needs a new binary, not an OTA.
const fingerprint = JSON.parse(sh("npx expo-updates fingerprint:generate --platform ios")).hash;
console.log(`fingerprint  ${fingerprint}`);
if (runtime && fingerprint !== runtime) {
  die(`expected     ${runtime}`, "",
      "MISMATCH. Native inputs have changed since that build, so an OTA cannot reach it.",
      "This needs a new EAS build, not an update.");
}
console.log(runtime ? "runtime      MATCH" : "runtime      not checked (--any-runtime)");
console.log(`commit       ${sh("git -C .. rev-parse HEAD")}`);

const cmd = `npx eas-cli update --branch production --platform ios --environment production --message ${JSON.stringify(message)} --non-interactive`;
if (has("--dry-run")) { console.log(`\nwould run:\n  ${cmd}`); process.exit(0); }
console.log(`\n${cmd}\n`);
execSync(cmd, { stdio: "inherit" });
