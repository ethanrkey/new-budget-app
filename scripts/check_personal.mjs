// A gate against committing one real person's financial life.
//
//   node scripts/check_personal.mjs            every tracked file
//   node scripts/check_personal.mjs <paths...> just these
//
// WHY THIS EXISTS. On 2026-10-15 a sweep found the author's own bank
// name hardcoded in `ledgerCsvImport.ts`'s category guesser — shipping
// to every user and matching nothing for anyone else — his real
// checking balance used four times as the "measured example", and his
// girlfriend's name in a CSV fixture. None of it was malicious and
// none of it was noticed for weeks, because every one of those reads
// perfectly naturally while you are writing it. A rule nobody can
// forget is the only kind that helps here.
//
// THE TERMS LIVE OUTSIDE GIT, which is the whole design. A committed
// list of "things that must never be committed" is the thing it is
// trying to prevent: it would put the bank name, the balance and the
// girlfriend's name in the repo, in one convenient file, for ever. So
// the list is at .personal-terms, gitignored, and this script is
// useless without it — which is correct. Somebody cloning this repo
// has nothing to protect and gets a clean skip.
//
// IT SKIPS QUIETLY WHEN THE FILE IS ABSENT. That is the one thing that
// could make this annoying rather than useful: CI, a second machine
// and a contributor all run `npm test`, and none of them have the
// file. A skip is not a pass and the line says so, but it is not a
// failure either.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const TERMS_FILE = new URL("../.personal-terms", import.meta.url);

if (!existsSync(TERMS_FILE)) {
  console.log("PERSONAL TERMS: no .personal-terms on this machine — skipped (see scripts/check_personal.mjs)");
  process.exit(0);
}

// One term per line. Blank lines and # comments ignored, and the
// comparison is case-insensitive, because "EverBank" and "everbank"
// are the same mistake.
const terms = readFileSync(TERMS_FILE, "utf8")
  .split("\n")
  .map((line) => line.replace(/\s+$/, ""))
  .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));

if (terms.length === 0) {
  console.log("PERSONAL TERMS: .personal-terms is empty — nothing to check");
  process.exit(0);
}

// TRACKED FILES ONLY. An untracked scratch file is not a leak, and
// node_modules would take a minute and find a thousand false hits.
// `-z` because a filename may contain anything but NUL.
const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const argv = process.argv.slice(2);
const files = (argv.length ? git(["ls-files", "-z", "--", ...argv]) : git(["ls-files", "-z"]))
  .split("\0")
  .filter(Boolean)
  // Binary files cannot usefully be grepped and a PNG will match
  // almost any short term by chance.
  .filter((f) => !/\.(png|jpe?g|gif|webp|ico|pdf|zip|car|ipa|woff2?|ttf|otf|mp4|mov)$/i.test(f))
  // This file names the problem in its own comments, and the spec and
  // the ignore rule have to be able to NAME the file without tripping
  // on it. Nothing here can contain a term by accident; they are the
  // three places that talk ABOUT the gate.
  .filter((f) => !["scripts/check_personal.mjs", ".gitignore"].includes(f));

const lower = terms.map((t) => t.toLowerCase());
const hits = [];
for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }   // deleted, or unreadable
  // A quick reject first: most files contain none of the terms, and
  // lowercasing once beats lowercasing per term.
  const hay = text.toLowerCase();
  const found = lower.filter((t) => hay.includes(t));
  if (found.length === 0) continue;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    for (const t of found) {
      if (line.includes(t)) hits.push({ file, line: i + 1, term: terms[lower.indexOf(t)] });
    }
  }
}

if (hits.length === 0) {
  console.log(`PERSONAL TERMS OK (${terms.length} term${terms.length === 1 ? "" : "s"}, ${files.length} tracked files)`);
  process.exit(0);
}

// THE TERM IS NAMED AND THE LINE IS NOT. Printing the matching line
// would copy the thing into a terminal, a CI log and a screenshot of
// the failure — which is most of the way to committing it. The file
// and the line number are enough to find it.
console.error(`\n${hits.length} PERSONAL TERM MATCH${hits.length === 1 ? "" : "ES"} in tracked files:\n`);
for (const h of hits) console.error(`  ${h.file}:${h.line}  matches "${h.term}"`);
console.error(`
These come from .personal-terms, which is gitignored and is not in this
repo. Replace each one with a generic example — a KIND OF THING, never
a brand and never an account somebody actually has (PROJECT_SPEC.md
band G item 24a). If a match is a false positive, narrow the term.
`);
process.exit(1);
