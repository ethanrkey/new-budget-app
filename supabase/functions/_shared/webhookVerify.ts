// Is this webhook actually from Plaid?
//
// THE DESIGN ALREADY MADE A FORGERY NEARLY HARMLESS, and this is
// still worth having. plaid-exchange treats a webhook body as a
// TRIGGER and nothing else: it looks the link_token up in a table
// only this app writes and then asks Plaid what happened. So someone
// who guesses a link_token can make us ask a question; they cannot
// supply the answer. What they CAN do is make us spend calls, and on
// a plan billed per request with ten Items for life that is not
// nothing. The signature is the proper answer to it, and it was on
// the pre-production list from the day the webhook was written.
//
// PLAID'S ALGORITHM, in their order, because each step is load
// bearing:
//
//   1. `Plaid-Verification` is a JWT. Decode its header and REFUSE
//      ANY ALG BUT ES256 before going near the signature. To be
//      straight about what this buys HERE: the hole it is famous for
//      closing — `alg: none`, or an HMAC verified with the public
//      key as its secret — is already shut by structure, because
//      nothing below reads `alg` to choose anything. ECDSA/P-256/
//      SHA-256 is hardcoded, so a forged `none` fails on the
//      signature anyway. The check is kept because the structure is
//      the kind that gets refactored, and because a token refused
//      for `bad_alg:none` says in the log what someone was trying.
//   2. Look the `kid` up through /webhook_verification_key/get.
//      A key that comes back with `expired_at` set is refused: Plaid
//      rotates keys and still serves the retired ones.
//   3. Verify the signature with that key.
//   4. `iat` within five minutes, so a captured webhook cannot be
//      replayed tomorrow.
//   5. sha256 OF THE RAW BODY equals the `request_body_sha256`
//      claim. THIS is the step that makes the rest mean anything:
//      without it a valid signature over somebody else's body would
//      authenticate any payload at all. Which is why the caller
//      hands in the exact text it received and parses afterwards,
//      never JSON.parse-then-re-stringify — that is a different
//      string the moment Plaid puts a space anywhere we would not.
//
// FAIL CLOSED. The one real cost is that a bug here stops iOS
// connecting at all, because Hosted Link has no other completion
// signal. That is the right way round: a broken Connect is visible
// in a minute and an unauthenticated webhook endpoint is not.

/** The shape /webhook_verification_key/get returns under `key`. */
export interface PlaidJwk {
  kty?: string; crv?: string; x?: string; y?: string;
  alg?: string; kid?: string; use?: string;
  created_at?: number; expired_at?: number | null;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Five minutes, from Plaid's own guidance. */
export const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const b64urlToJson = (s: string): Record<string, unknown> | null => {
  try { return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))); }
  catch { return null; }
};

/** Lowercase hex sha256 of a string, the shape Plaid's claim is in. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Equal, without telling anyone how nearly.
 *
 * A `===` on a hash leaks where it stopped matching, and this one is
 * compared against a value an attacker chooses. Cheap to do right.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify one webhook.
 *
 * `fetchKey` IS INJECTED rather than called from in here, for two
 * reasons: this file then has no idea what a Plaid client is and can
 * be tested against a key pair generated in the test, and the caller
 * keeps its own cache — which it needs, because an uncached verify
 * is one extra Plaid call per webhook.
 */
export async function verifyPlaidWebhook(opts: {
  /** The `Plaid-Verification` header, verbatim. */
  header: string | null;
  /** THE RAW BODY TEXT, exactly as received. */
  body: string;
  fetchKey: (keyId: string) => Promise<PlaidJwk | null>;
  /** Unix seconds; injectable so the clock can be tested. */
  now?: number;
}): Promise<VerifyResult> {
  const { header, body, fetchKey } = opts;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  if (!header) return { ok: false, reason: "no_verification_header" };
  const parts = header.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed_jwt" };
  const [headerPart, payloadPart, signaturePart] = parts;

  // STEP 1 — the algorithm, before anything else.
  const jwtHeader = b64urlToJson(headerPart);
  if (!jwtHeader) return { ok: false, reason: "malformed_header" };
  if (jwtHeader.alg !== "ES256") return { ok: false, reason: `bad_alg:${String(jwtHeader.alg)}` };
  const keyId = typeof jwtHeader.kid === "string" ? jwtHeader.kid : "";
  if (!keyId) return { ok: false, reason: "no_kid" };

  // STEP 2 — the key, and only a live one.
  const jwk = await fetchKey(keyId);
  if (!jwk) return { ok: false, reason: "unknown_key" };
  if (jwk.expired_at != null) return { ok: false, reason: "expired_key" };

  // STEP 3 — the signature. ES256 signatures are raw r‖s, which is
  // what Web Crypto's ECDSA wants; no DER unwrapping here.
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty ?? "EC", crv: jwk.crv ?? "P-256", x: jwk.x, y: jwk.y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, reason: "bad_key" };
  }
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  let good = false;
  try {
    good = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, key, b64urlToBytes(signaturePart), signed,
    );
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (!good) return { ok: false, reason: "bad_signature" };

  const claims = b64urlToJson(payloadPart);
  if (!claims) return { ok: false, reason: "malformed_claims" };

  // STEP 4 — freshness. A signature stays valid forever; this is
  // what stops a captured webhook being replayed tomorrow.
  const iat = typeof claims.iat === "number" ? claims.iat : null;
  if (iat == null) return { ok: false, reason: "no_iat" };
  if (now - iat > WEBHOOK_MAX_AGE_SECONDS) return { ok: false, reason: "stale" };

  // STEP 5 — and this is the one that ties the signature to THIS body.
  const claimed = typeof claims.request_body_sha256 === "string" ? claims.request_body_sha256 : "";
  if (!claimed) return { ok: false, reason: "no_body_hash" };
  if (!constantTimeEquals(claimed.toLowerCase(), await sha256Hex(body))) {
    return { ok: false, reason: "body_mismatch" };
  }

  return { ok: true };
}
