// The client secret Apple's token endpoints want, verified against a
// real P-256 key.
//
//   node tests/apple-secret.test.mjs     (runs in `npm test`, so in CI)
//
// This is the one piece of the Sign in with Apple work that CANNOT be
// checked by running the app: it needs the .p8, which lives in Supabase
// secrets and nowhere on this machine, and its failure mode is an
// opaque 400 from appleid.apple.com with no clue which of four things
// is wrong. So the signing is tested with a key generated here, which
// proves everything except that the real key is the right key:
//
//   - the PEM parses (the \n-vs-literal-backslash-n trap included);
//   - the JWS is three base64url parts;
//   - the header carries ES256 and the Key ID, which is how Apple
//     finds the public half;
//   - the payload carries the Team ID as issuer, the BUNDLE ID as
//     subject — the native flow has no Services ID — and Apple's own
//     audience;
//   - and the signature VERIFIES, which is the half a hand-rolled JWS
//     gets wrong. Web Crypto's ECDSA output is already the raw r||s
//     that JWS wants; a DER signature would be silently accepted by
//     every assertion except this one.
import { clientSecret, readConfig } from "../supabase/functions/_shared/apple.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, c) => eq(label, !!c, true);

const b64 = (buf) => Buffer.from(buf).toString("base64");
const pem = (der) => `-----BEGIN PRIVATE KEY-----\n${b64(der).match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privatePem = pem(await crypto.subtle.exportKey("pkcs8", pair.privateKey));

const CONFIG = {
  teamId: "9WJSHTF3EB",
  keyId: "B58KDZ42WV",
  privateKey: privatePem,
  clientId: "app.keybudget",
};
const NOW = 1_760_000_000;

const jwt = await clientSecret(CONFIG, NOW);
const [h, p, sig] = jwt.split(".");
eq("three parts", jwt.split(".").length, 3);
is("base64url only — no +, / or padding", /^[A-Za-z0-9_.-]+$/.test(jwt));

const header = JSON.parse(fromB64url(h).toString());
eq("signed ES256", header.alg, "ES256");
eq("and names the Key ID, which is how Apple finds the public half", header.kid, "B58KDZ42WV");
eq("typ JWT", header.typ, "JWT");

const payload = JSON.parse(fromB64url(p).toString());
eq("issued by the Team ID", payload.iss, "9WJSHTF3EB");
// The native flow's client id IS the bundle id. A Services ID here is
// the single likeliest way to get an opaque 400 back from Apple.
eq("for the bundle id, not a Services ID", payload.sub, "app.keybudget");
eq("audience is Apple", payload.aud, "https://appleid.apple.com");
eq("issued now", payload.iat, NOW);
is("and expires inside Apple's six-month limit", payload.exp > NOW && payload.exp - NOW <= 15_777_000);

// THE ONE THAT MATTERS.
const verified = await crypto.subtle.verify(
  { name: "ECDSA", hash: "SHA-256" },
  pair.publicKey,
  fromB64url(sig),
  new TextEncoder().encode(`${h}.${p}`),
);
is("the signature verifies against the key that signed it", verified);

// ...and a signature over different bytes does not, so the check above
// is a check.
const tampered = await crypto.subtle.verify(
  { name: "ECDSA", hash: "SHA-256" },
  pair.publicKey,
  fromB64url(sig),
  new TextEncoder().encode(`${h}.${p}x`),
);
eq("a tampered payload does not verify", tampered, false);

// ---- the secrets, and the trap in pasting a .p8 into a web form -----
{
  // A key pasted into the Supabase dashboard routinely arrives with
  // literal backslash-n instead of newlines, and the result is an hour
  // of ASN.1 errors that say nothing about newlines.
  const flattened = privatePem.replace(/\n/g, "\\n");
  const env = {
    APPLE_TEAM_ID: " 9WJSHTF3EB ",
    APPLE_KEY_ID: "B58KDZ42WV",
    APPLE_PRIVATE_KEY: flattened,
    APPLE_BUNDLE_ID: "app.keybudget",
  };
  globalThis.Deno = { env: { get: (k) => env[k] } };

  const read = readConfig();
  is("all four secrets present means a config", "config" in read);
  eq("whitespace around an id is trimmed", read.config.teamId, "9WJSHTF3EB");
  is("and a flattened key is repaired", read.config.privateKey.includes("\n"));
  // Proof the repair is enough: the repaired key signs, and the
  // signature verifies. Not compared to the one above — ECDSA is
  // randomized, so two signings of identical bytes differ, and an
  // equality check here would be a check on the nonce.
  const [h2, p2, sig2] = (await clientSecret(read.config, NOW)).split(".");
  eq("...and produces the same header and payload", [h2, p2], [h, p]);
  is("...signed well enough to verify", await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, pair.publicKey,
    fromB64url(sig2), new TextEncoder().encode(`${h2}.${p2}`),
  ));

  delete env.APPLE_PRIVATE_KEY;
  const missing = readConfig();
  eq("a missing secret is named rather than guessed at", missing.missing, ["APPLE_PRIVATE_KEY"]);
  env.APPLE_PRIVATE_KEY = "   ";
  eq("and a blank one counts as missing", readConfig().missing, ["APPLE_PRIVATE_KEY"]);
}

// A SUITE THAT RUNS NO CHECKS EXITS 0, and that is not hypothetical: a
// bad edit truncated tests/signin.test.mjs to its header on 2026-10-14
// and `npm test` stayed green through the whole run. The floor is
// deliberately far below any real count — it is here to catch a file
// that has been emptied, not to track how many checks it should have.
if (checks < 10) {
  console.log(`FAIL  this suite ran only ${checks} checks — truncated, or short-circuited before the end`);
  failures++;
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
