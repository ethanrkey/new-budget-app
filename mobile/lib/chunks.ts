// Splitting a value across several Keychain items, and the arithmetic
// that makes it safe.
//
// WHY THIS EXISTS. iOS SecureStore stores one value per key and
// expo-secure-store documents a 2048-BYTE limit per value: "an attempt
// to store larger values may fail". A Supabase session is an access
// token (a JWT, about a kilobyte on its own), a refresh token, the
// expiry and the whole user object — comfortably over that. The
// alternative pattern, the one Supabase's own docs show, encrypts the
// session with AES and keeps only the key in the Keychain; that puts
// the ciphertext in AsyncStorage and brings in a cipher and a CSPRNG
// polyfill. Chunking keeps the secret itself in the Keychain and adds
// no dependency, which is the stronger of the two and the smaller.
//
// SEPARATE FROM THE ADAPTER THAT USES IT, so the arithmetic below can
// be tested in plain node — see tests/mobile-securestore.test.mjs.
// lib/secureStorage.ts imports a native module and cannot be.

/**
 * How many JS characters go in one chunk.
 *
 * THE BOUND IS PROVED, NOT GUESSED. The limit is on BYTES and a JS
 * string is UTF-16 code units, so the question is how many bytes one
 * code unit can become:
 *
 *   - U+0000..U+007F  -> 1 byte
 *   - U+0080..U+07FF  -> 2 bytes
 *   - U+0800..U+FFFF  -> 3 bytes
 *   - a surrogate PAIR (two code units) -> 4 bytes, so 2 per unit
 *
 * The worst case is therefore 3 bytes per code unit, not 4: the
 * 4-byte case costs two units to reach. 600 x 3 = 1800, which clears
 * 2048 with room to spare, and for the ASCII a JWT is actually made
 * of it is 600 bytes.
 *
 * Splitting by code unit can cut a surrogate pair in half. That is
 * fine and deliberate: the halves are stored and re-joined verbatim,
 * and `parts.join("")` puts the pair back together before anything
 * interprets it. Nothing in between ever looks at the text.
 */
export const CHUNK_CHARS = 600;

/** The UTF-8 size of a string, without TextEncoder — Hermes has had it
 *  since RN 0.74, but this is the one number the bound above rests on
 *  and it should not depend on which engine is underneath. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length
             && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      n += 4; i++;                       // a surrogate pair, one code point
    } else n += 3;
  }
  return n;
}

/** Split a value into the pieces that will become Keychain items.
 *  An empty string is ONE empty chunk rather than none, so that
 *  storing "" and storing nothing stay distinguishable. */
export function splitChunks(value: string): string[] {
  if (value.length === 0) return [""];
  const out: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_CHARS) out.push(value.slice(i, i + CHUNK_CHARS));
  return out;
}

/** The key a chunk is stored under. SecureStore keys may contain only
 *  alphanumerics, ".", "-" and "_", which this and Supabase's own
 *  "sb-<ref>-auth-token" both satisfy. */
export function chunkKey(key: string, i: number): string {
  return `${key}.part.${i}`;
}

/** What the manifest at `key` holds: how many chunks to read back.
 *  A number rather than a JSON blob, because the one thing this must
 *  never do is fail to parse and lose a session. */
export function manifestOf(chunks: string[]): string {
  return String(chunks.length);
}

/** Read a manifest back. Anything that is not a positive integer is
 *  treated as no value at all — a half-written manifest must look
 *  like "nothing stored" rather than like "0 chunks of session". */
export function parseManifest(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 10000 ? n : null;
}
