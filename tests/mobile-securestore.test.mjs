// The arithmetic that keeps a Supabase session inside the Keychain's
// per-value limit. Pure node, no native module — the adapter that
// calls these lives in mobile/lib/secureStorage.ts and is exercised
// in mobile/__tests__/securestore.test.tsx with SecureStore mocked.
//
// THE CLAIM UNDER TEST IS A BOUND: no chunk this produces can exceed
// 2048 UTF-8 bytes, whatever is in the string. Everything else here
// is round-tripping.
import { CHUNK_CHARS, utf8Bytes, splitChunks, chunkKey, manifestOf, parseManifest } from "../mobile/lib/chunks.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) { failures++; console.log(`FAIL  ${label}\n      got  ${show(got)}\n      want ${show(want)}`); }
  else console.log(`PASS  ${label}`);
}
const is = (label, v) => eq(label, !!v, true);

console.log("== mobile/lib/chunks ==");

// ---- utf8Bytes, because the bound rests on it ------------------------
eq("ascii is one byte each", utf8Bytes("abc"), 3);
eq("latin-1 is two", utf8Bytes("éé"), 4);
eq("a BMP character is three", utf8Bytes("€"), 3);                 // euro sign
eq("an emoji is four, not six", utf8Bytes("\u{1F511}"), 4);             // surrogate pair
eq("a lone high surrogate is three, not four",
  utf8Bytes(String.fromCharCode(0xd83d)), 3);
eq("empty is nothing", utf8Bytes(""), 0);

// ---- THE BOUND -------------------------------------------------------
//
// The limit is on BYTES; a chunk is counted in UTF-16 code units. The
// worst case is 3 bytes per unit, because the 4-byte case needs two
// units to reach it — so CHUNK_CHARS * 3 is the ceiling and it has to
// clear 2048.
const LIMIT = 2048;
eq("the worst case clears the limit", CHUNK_CHARS * 3 < LIMIT, true);

const worst = [
  ["ascii", "x"],
  ["two-byte", "é"],
  ["three-byte", "€"],
  ["emoji (surrogate pairs)", "\u{1F511}"],
];
for (const [name, unit] of worst) {
  // Long enough to need several chunks whatever the unit costs.
  const value = unit.repeat(5000);
  const parts = splitChunks(value);
  const biggest = Math.max(...parts.map(utf8Bytes));
  is(`${name}: every chunk fits in ${LIMIT} bytes (worst ${biggest})`, biggest <= LIMIT);
  eq(`${name}: it joins back to exactly what went in`, parts.join("") === value, true);
}

// A surrogate pair split across the boundary is the case that would
// corrupt text if anything in between interpreted it. Nothing does,
// and this proves the halves rejoin.
{
  const value = "a" + "\u{1F511}".repeat(CHUNK_CHARS);   // the pair straddles 600
  const parts = splitChunks(value);
  is("a split surrogate pair is rejoined verbatim", parts.join("") === value);
  is("...and it really was split", parts.length > 1);
}

// ---- the shapes around it -------------------------------------------
eq("a short value is one chunk", splitChunks("hello"), ["hello"]);
eq("empty is one EMPTY chunk, not none", splitChunks(""), [""]);
eq("601 characters is two chunks", splitChunks("a".repeat(601)).length, 2);
eq("exactly 600 is one", splitChunks("a".repeat(CHUNK_CHARS)).length, 1);

eq("chunk keys are Keychain-legal",
  /^[A-Za-z0-9._-]+$/.test(chunkKey("sb-kjcvtpmorftjyejjskwm-auth-token", 3)), true);
eq("...and they are numbered", chunkKey("k", 3), "k.part.3");

eq("the manifest is the count", manifestOf(["a", "b", "c"]), "3");
eq("a manifest round-trips", parseManifest(manifestOf(["a", "b"])), 2);
eq("no manifest means no value", parseManifest(null), null);
// A half-written manifest has to look like "nothing stored" rather
// than like "zero chunks of session", which would hand supabase-js an
// empty string and sign the user out.
eq("junk means no value", parseManifest("abc"), null);
eq("zero means no value", parseManifest("0"), null);
eq("a negative means no value", parseManifest("-1"), null);
eq("a fraction means no value", parseManifest("1.5"), null);
eq("an absurd count means no value", parseManifest("99999"), null);

console.log(failures ? `\n${failures} FAILED (${checks} checks)` : `\nALL PASS (${checks} checks)`);
process.exit(failures ? 1 : 0);
