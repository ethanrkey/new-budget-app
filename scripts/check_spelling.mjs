// American spelling, enforced rather than remembered.
//
//   node scripts/check_spelling.mjs     (runs in npm test, so in CI)
//
// Rule 1a says American everywhere — UI copy, comments, the spec. It was
// swept once by hand on 2026-10-08 (124 occurrences of "colour" and
// eleven other forms across 32 files) and the obvious thing happened: new
// British spellings started appearing again the same week, in prose I
// wrote. A convention nobody checks is a convention that decays.
//
// Word-by-word, never by stem, because the stems are landmines: `optimis`
// catches "optimistic", `instal` catches "install", `cancell` catches
// "cancellation" which is correct in both. Generated files are excluded —
// a stem replacement once rewrote `@babel/helper-optimise-call-expression`
// inside a lockfile and would have broken the install.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const WORDS = {
  colour: "color", colours: "colors", coloured: "colored", colouring: "coloring",
  recolour: "recolor", recolours: "recolors", colourful: "colorful",
  behaviour: "behavior", behaviours: "behaviors", behavioural: "behavioral",
  honour: "honor", honours: "honors", honoured: "honored",
  neighbour: "neighbor", neighbours: "neighbors", neighbouring: "neighboring",
  grey: "gray", greyed: "grayed", greys: "grays",
  cancelled: "canceled", cancelling: "canceling", cancellable: "cancelable",
  labelled: "labeled", labelling: "labeling", mislabelled: "mislabeled",
  unravelling: "unraveling", travelling: "traveling", modelling: "modeling",
  signalling: "signaling", totalling: "totaling", fuelled: "fueled",
  canonicalise: "canonicalize", canonicalised: "canonicalized",
  categorise: "categorize", categorised: "categorized", uncategorised: "uncategorized",
  customise: "customize", customisation: "customization", customised: "customized",
  normalise: "normalize", normalised: "normalized", normalisation: "normalization",
  linearise: "linearize", linearised: "linearized",
  memorise: "memorize", memorised: "memorized",
  optimise: "optimize", optimises: "optimizes", optimised: "optimized",
  optimising: "optimizing", optimisation: "optimization",
  organise: "organize", organised: "organized", organisation: "organization",
  recognise: "recognize", recognised: "recognized",
  realise: "realize", realised: "realized",
  prioritise: "prioritize", summarise: "summarize", emphasise: "emphasize",
  apologise: "apologize", analyse: "analyze", analysed: "analyzed",
  quantise: "quantize", quantises: "quantizes", unquantised: "unquantized",
  metres: "meters", metre: "meter", centre: "center", centres: "centers",
  acknowledgement: "acknowledgment", judgement: "judgment",
  whilst: "while", amongst: "among",
  defence: "defense", licence: "license", offence: "offense",
  catalogue: "catalog", dialogue: "dialog", analogue: "analog",
};

// ---- commit-message mode -------------------------------------------------
// `node scripts/check_spelling.mjs --messages <rev-range>`
//
// Added after the rule was broken three times in one day, every time in
// prose rather than in code, and once INSIDE THE COMMIT that hardened the
// rule. "Prose discipline stays mine" was tested and failed, so it is a
// gate now. Installed with `npm run hooks:install`, which points
// core.hooksPath at scripts/hooks so the hook is versioned like anything
// else rather than living unshared in .git.
const messagesArg = process.argv.indexOf("--messages");
if (messagesArg !== -1) {
  const range = process.argv[messagesArg + 1];
  if (!range) { console.error("--messages needs a rev-range"); process.exit(2); }
  let log = "";
  try {
    log = execSync(`git log --format=%H%x00%B%x01 ${range}`, { encoding: "utf8" });
  } catch {
    process.exit(0);     // nothing to compare against (a new branch, say)
  }
  const pattern = buildPattern();
  let bad = 0;
  for (const entry of log.split("\u0001")) {
    if (!entry.trim()) continue;
    const [sha, body] = entry.split("\u0000");
    for (const m of (body ?? "").matchAll(pattern)) {
      bad++;
      console.log(`${sha.slice(0, 8)}  "${m[0]}" → "${WORDS[m[0].toLowerCase()]}"`);
    }
  }
  console.log(bad === 0 ? "COMMIT MESSAGES OK (American)" : `\n${bad} BRITISH SPELLING(S) in commit messages`);
  process.exit(bad === 0 ? 0 : 1);
}

const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".ico", ".ttf", ".woff", ".woff2", ".webmanifest"]);
const SKIP_FILE = new Set(["package-lock.json", "mobile/package-lock.json", "scripts/check_spelling.mjs"]);

function buildPattern() {
  return new RegExp(`\\b(${Object.keys(WORDS).join("|")})\\b`, "gi");
}
const pattern = buildPattern();
const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);

let hits = 0;
for (const file of files) {
  if (SKIP_EXT.has(extname(file).toLowerCase()) || SKIP_FILE.has(file)) continue;
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(pattern)) {
      hits++;
      const found = m[0];
      console.log(`${file}:${i + 1}  "${found}" → "${WORDS[found.toLowerCase()]}"`);
    }
  });
}

console.log(hits === 0 ? "\nSPELLING OK (American)" : `\n${hits} BRITISH SPELLING(S)`);
process.exit(hits === 0 ? 0 : 1);
