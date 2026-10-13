import { createClient } from "jsr:@supabase/supabase-js@2";
import { readConfig, exchangeCode } from "../_shared/apple.ts";

// Store the Apple refresh token for the user who just signed in.
//
// WHY IT HAS TO HAPPEN NOW. `signInAsync` returns an authorizationCode
// that EXPIRES IN FIVE MINUTES AND CAN BE USED ONCE. Keeping it and
// exchanging it at deletion, possibly months later, exchanges nothing.
// So the app posts it the moment the sign-in succeeds, this exchanges
// it, and the REFRESH TOKEN — which does not expire that way — is what
// gets stored and what is revoked when the account is purged.
//
// The app does not wait on this and is not told if it fails. A user
// who has just authenticated is signed in; a failure to file a token
// for a deletion that may never happen is not their error message.
// Every Apple sign-in returns a fresh code and re-links, so a
// transient failure heals itself the next time they sign in.
//
// Deploy:
//   npx supabase functions deploy apple-link --project-ref <ref>
// JWT verification stays ON (the default): this must only ever run for
// a real, signed-in user, because the row it writes is keyed by them.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const conf = readConfig();
  if ("missing" in conf) {
    // Named, so the dashboard page to open is obvious. The names of
    // secrets are not secret; their values are, and none is logged.
    console.error("[apple-link] missing secrets:", conf.missing.join(", "));
    return json(500, { error: `not configured: ${conf.missing.join(", ")}` });
  }

  let code: string;
  try {
    const body = await req.json();
    code = String(body?.code ?? "");
  } catch {
    return json(400, { error: "expected { code }" });
  }
  if (!code) return json(400, { error: "expected { code }" });

  // WHO IS CALLING, asked of the caller's own token rather than taken
  // from the request body. A user id in a payload is a user id anyone
  // can type.
  const authorization = req.headers.get("Authorization") ?? "";
  const asUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error: whoError } = await asUser.auth.getUser();
  if (whoError || !user) return json(401, { error: "not signed in" });

  const exchanged = await exchangeCode(conf.config, code);
  if ("error" in exchanged) {
    console.error("[apple-link]", exchanged.error);
    return json(502, { error: "apple refused the authorization code" });
  }

  // The service role, because apple_tokens has RLS on and no policies:
  // nobody reads or writes it as a user, including its own owner.
  const asService = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error: writeError } = await asService
    .from("apple_tokens")
    .upsert({ user_id: user.id, refresh_token: exchanged.refreshToken, updated_at: new Date().toISOString() });
  if (writeError) {
    console.error("[apple-link] write failed:", writeError.message);
    return json(500, { error: "could not store the token" });
  }

  return json(200, { ok: true });
});
