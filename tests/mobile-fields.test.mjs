// Every TextInput on the phone states its own text attributes.
//
//   node tests/mobile-fields.test.mjs     (runs in `npm test`, so in CI)
//
// WHY A SOURCE-READING TEST RATHER THAN A RENDERED ONE. The bug this
// guards against is invisible to the renderer: see mobile/lib/fields.ts
// for the whole story, but the short version is that iOS recycles a
// native text-input view onto the next screen and keeps the attributes
// the LAST field set. The JS was always right. Mounting a component and
// reading its styles therefore proves nothing about the thing that goes
// wrong — what has to be true is a property of the SOURCE: no field
// anywhere may stay silent about letterSpacing and fontVariant, because
// silence is what the stale value fills.
//
// So this walks the mobile components, finds every <TextInput>, works
// out which StyleSheet entries it wears, and checks that at least one of
// them spreads FIELD_TEXT. A new field added without it fails here
// rather than three screens away on somebody's phone.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let failures = 0, checks = 0;
function is(label, ok) {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

const ROOTS = ["mobile/components", "mobile/app", "mobile/app/(tabs)"];

/** Every .tsx under the roots, without recursing twice into (tabs). */
function sources() {
  const out = [];
  for (const root of ROOTS) {
    let names;
    try { names = readdirSync(root); } catch { continue; }
    for (const name of names) {
      if (name.endsWith(".tsx")) out.push(join(root, name));
    }
  }
  return out.sort();
}

/**
 * The style expression on each <TextInput ...> in a file.
 *
 * Deliberately crude: it takes the text from `<TextInput` to the first
 * `/>` and pulls `style={...}` out of it. The components here all close
 * their inputs that way, and a parser that understood JSX properly
 * would be a bigger thing to keep right than the rule it enforces.
 */
function inputStyles(src) {
  const found = [];
  let at = 0;
  for (;;) {
    const open = src.indexOf("<TextInput", at);
    if (open === -1) break;
    // `useRef<TextInput>(null)` is not a field. The element always has
    // whitespace after its name; the type argument always has `>`.
    if (!/\s/.test(src[open + 10] ?? "")) { at = open + 10; continue; }
    const end = src.indexOf("/>", open);
    const tag = src.slice(open, end === -1 ? src.length : end);
    const style = /style=\{([^}]*(?:\}[^}]*)*?)\}\s/.exec(tag);
    found.push(style ? style[1] : null);
    at = open + 10;
  }
  return found;
}

/** The body of `name: { ... }` inside this file's StyleSheet.create. */
function styleBody(src, name) {
  const start = src.search(new RegExp(`^\\s*${name}:\\s*\\{`, "m"));
  if (start === -1) return null;
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

const files = sources();
is("there are components to read at all", files.length > 10);

let inputs = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const style of inputStyles(src)) {
    inputs++;
    const label = `${file.replace("mobile/", "")} field #${inputs}`;
    if (style === null) {
      is(`${label} has a style at all`, false);
      continue;
    }
    // Every `styles.x` the expression mentions; one of them must pin
    // the text attributes, and which one does not matter — a field
    // built from [base, variant] is as covered as one with a single
    // style, as long as the base says it.
    const keys = [...style.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    const pinned = keys.some((k) => (styleBody(src, k) ?? "").includes("FIELD_TEXT"));
    is(`${label} spreads FIELD_TEXT`, pinned);
  }
}

is("every TextInput in the app was reached", inputs >= 18);

// The code box is the one field that overrides the pin, and it must
// keep doing so — it is the reason the app has six separate digits
// rather than a six-digit number.
const signIn = readFileSync("mobile/components/SignIn.tsx", "utf8");
is("the six-digit code box still kerns", (styleBody(signIn, "codeField") ?? "").includes("letterSpacing: 8"));

// AND WHAT THE PIN ACTUALLY SAYS. Every field spreading FIELD_TEXT
// is worth nothing if FIELD_TEXT itself is wrong or empty — and
// until 2026-10-26 nothing checked: three mutations that emptied it,
// dropped half of it, and set the WRONG kern all survived a full
// run, because the only thing watching was "is it spread".
//
// Imported, not read as text: this is one of the few things in this
// file that IS a property of the value rather than of the source.
const { FIELD_TEXT } = await import("../mobile/lib/fields.ts");
is("the pin states a letter spacing", "letterSpacing" in FIELD_TEXT);
is("...and it is zero, which is what a recycled kern has to be overwritten with",
  FIELD_TEXT.letterSpacing === 0);
is("the pin states a font variant too — the other attribute that can ride across",
  "fontVariant" in FIELD_TEXT);
is("...and it is empty, so a field wanting tabular figures states its own",
  Array.isArray(FIELD_TEXT.fontVariant) && FIELD_TEXT.fontVariant.length === 0);
// A value, never an absence: absence is precisely what the stale
// attribute fills, so `undefined` here would be the bug wearing the
// fix's name.
is("neither is left undefined, which is the bug itself",
  FIELD_TEXT.letterSpacing !== undefined && FIELD_TEXT.fontVariant !== undefined);

// A SUITE THAT RUNS NO CHECKS EXITS 0 — see the note in
// tests/mobile-firstrun.test.mjs. The floor is far below any real count.
if (checks < 10) {
  console.log(`FAIL  this suite ran only ${checks} checks — truncated, or short-circuited before the end`);
  failures++;
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
