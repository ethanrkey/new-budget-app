import { createClient } from "jsr:@supabase/supabase-js@2";
import { readConfig, revokeToken } from "../_shared/apple.ts";

// Drain the revocation queue: tell Apple the grants of purged accounts
// are over.
//
// WHY A QUEUE AND NOT A LOOKUP. `purge_due_accounts()` deletes the
// auth.users row, and apple_tokens cascades with it — so by the time
// anything could ask "which token belonged to the user we just
// deleted", the answer is gone. The purge copies the token into
// apple_revocations in the same statement, and this drains it.
//
// It is therefore NOT synchronous with deletion, and does not need to
// be: Apple asks that the grant be revoked, not that it be revoked in
// the same millisecond. What matters is that no purge can happen
// without queueing, which is a property of one SQL statement rather
// than of anything here.
//
// Deploy:
//   npx supabase functions deploy apple-revoke --project-ref <ref>
// Call it from pg_cron + pg_net, or by hand — see supabase/apple_tokens.sql.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** How many to attempt per call. The queue is almost always empty. */
const BATCH = 50;

Deno.serve(async (req) => {
  // SERVICE ROLE ONLY, checked here and not left to JWT verification
  // alone. A signed-in user's token is also a valid JWT, and this
  // endpoint must not be something any user can trigger: it talks to
  // Apple on the project's behalf, with the project's signing key.
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (presented !== service) return json(403, { error: "service role only" });

  const conf = readConfig();
  if ("missing" in conf) {
    console.error("[apple-revoke] missing secrets:", conf.missing.join(", "));
    return json(500, { error: `not configured: ${conf.missing.join(", ")}` });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, service);
  const { data: pending, error } = await db
    .from("apple_revocations")
    .select("id,refresh_token")
    .is("revoked_at", null)
    .order("queued_at", { ascending: true })
    .limit(BATCH);
  if (error) return json(500, { error: error.message });

  let revoked = 0;
  const failed: number[] = [];
  for (const row of pending ?? []) {
    const result = await revokeToken(conf.config, row.refresh_token);
    if ("ok" in result) {
      // The token is cleared on success rather than kept. The row stays
      // — "did we revoke this, and when" is worth being able to answer
      // — but the secret in it has done its only job.
      await db.from("apple_revocations")
        .update({ revoked_at: new Date().toISOString(), refresh_token: "", last_error: null })
        .eq("id", row.id);
      revoked++;
    } else {
      console.error("[apple-revoke]", result.error);
      // LEFT IN THE QUEUE, deliberately. A failure here means Apple
      // still believes the grant is live, and dropping the row would
      // make that permanent and invisible.
      await db.from("apple_revocations").update({ last_error: result.error.slice(0, 500) }).eq("id", row.id);
      failed.push(row.id);
    }
  }

  return json(200, { attempted: pending?.length ?? 0, revoked, failed });
});
