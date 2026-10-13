// The client secret Apple's token endpoints want, and the two calls
// that use it. Shared by apple-link and apple-revoke.
//
// APPLE DOES NOT ISSUE A CLIENT SECRET. You mint one: a JWT, signed
// ES256 with the .p8 key downloaded once from the developer portal,
// valid for at most six months. That is why these endpoints cannot be
// called from the app — a signing key in a client is not a key — and
// why this is an edge function at all.
//
// NO LIBRARY. The whole of JWS ES256 is a base64url header, a
// base64url payload, and a P-256 signature over the two with a dot
// between them. Web Crypto produces exactly the raw r||s signature JWS
// specifies, so there is nothing to convert. A dependency here would
// be a supply-chain surface around a signing key, which is the worst
// place in this project to have one.

const enc = new TextEncoder();

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** The DER bytes inside a PEM, whatever line endings it arrived with. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface AppleConfig {
  teamId: string;
  keyId: string;
  /** The .p8 file's contents, PEM and all. */
  privateKey: string;
  /** The NATIVE flow's client id IS the bundle id. No Services ID. */
  clientId: string;
}

/** Every secret this needs, or a list of the ones that are missing. */
export function readConfig(): { config: AppleConfig } | { missing: string[] } {
  const names = ["APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY", "APPLE_BUNDLE_ID"] as const;
  const values = names.map((n) => Deno.env.get(n) ?? "");
  const missing = names.filter((_, i) => values[i]!.trim() === "");
  if (missing.length) return { missing };
  return {
    config: {
      teamId: values[0]!.trim(),
      keyId: values[1]!.trim(),
      // Secrets set through the dashboard routinely arrive with literal
      // \n instead of newlines. Repairing that here is the difference
      // between "it works" and an hour of ASN.1 errors.
      privateKey: values[2]!.replace(/\\n/g, "\n"),
      clientId: values[3]!.trim(),
    },
  };
}

/**
 * Mint the client secret.
 *
 * Six months is the maximum Apple allows and is irrelevant here: this
 * is minted per request and used once, which means there is no secret
 * to rotate, expire or leak into a log. Ten minutes is plenty.
 */
export async function clientSecret(c: AppleConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = { alg: "ES256", kid: c.keyId, typ: "JWT" };
  const payload = {
    iss: c.teamId,
    iat: nowSeconds,
    exp: nowSeconds + 600,
    aud: "https://appleid.apple.com",
    // The subject is the client the secret is FOR, which for the native
    // flow is the app's bundle id.
    sub: c.clientId,
  };
  const signingInput = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(c.privateKey).buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput));
  return `${signingInput}.${b64url(signature)}`;
}

/**
 * Exchange the app's authorization code for a refresh token.
 *
 * The code expires in five minutes and works once, so this runs at
 * sign-in and never later.
 */
export async function exchangeCode(c: AppleConfig, code: string): Promise<{ refreshToken: string } | { error: string }> {
  const secret = await clientSecret(c);
  const res = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: secret,
      code,
      grant_type: "authorization_code",
    }),
  });
  const body = await res.text();
  if (!res.ok) return { error: `apple token ${res.status}: ${body}` };
  let parsed: { refresh_token?: string };
  try { parsed = JSON.parse(body); } catch { return { error: `apple token: unparseable body` }; }
  if (!parsed.refresh_token) return { error: "apple token: no refresh_token in response" };
  return { refreshToken: parsed.refresh_token };
}

/**
 * Revoke a refresh token. This is the thing Apple requires on deletion.
 *
 * A token Apple has already forgotten answers 400 `invalid_grant`, and
 * that is treated as SUCCESS: the grant is gone, which is the outcome
 * asked for, and retrying it forever would keep a dead row in the queue
 * for ever.
 */
export async function revokeToken(c: AppleConfig, refreshToken: string): Promise<{ ok: true } | { error: string }> {
  const secret = await clientSecret(c);
  const res = await fetch("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: secret,
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
  });
  if (res.ok) return { ok: true };
  const body = await res.text();
  if (res.status === 400 && /invalid_grant/.test(body)) return { ok: true };
  return { error: `apple revoke ${res.status}: ${body}` };
}
