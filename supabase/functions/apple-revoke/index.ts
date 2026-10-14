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

/** Wait this long before trying a token that already failed. */
const RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * Is this caller the service role?
 *
 * THE FIRST VERSION OF THIS MADE THE ENDPOINT UNCALLABLE, and nobody
 * noticed because nothing called it. It compared the bearer token to
 * `SUPABASE_SERVICE_ROLE_KEY` by string equality, which assumes the
 * caller holds the same bytes the runtime was handed. This project has
 * BOTH key formats live — legacy JWTs (`eyJ...`) and the newer
 * `sb_secret_...` keys — and they are not interchangeable here:
 *
 *   - the functions gateway accepts a legacy JWT and rejects an
 *     `sb_secret_...` key outright with 401 "Invalid API key";
 *   - the value injected as SUPABASE_SERVICE_ROLE_KEY is not the
 *     legacy JWT.
 *
 * So every possible caller failed one check or the other. Found
 * 2026-10-14 by trying to drain the queue by hand.
 *
 * The claim identifies the caller now. That is safe for one specific
 * reason, and the reason is worth stating because it can be taken
 * away: THE PLATFORM GATEWAY VERIFIES THE SIGNATURE BEFORE THIS CODE
 * RUNS. `verify_jwt` is on by default, and a forged or unsigned token
 * never arrives — measured, not assumed: a garbage bearer gets 401
 * from the gateway, while the anon key reaches this function and is
 * refused below. DEPLOYING THIS WITH `--no-verify-jwt` WOULD MAKE THE
 * ROLE CLAIM FORGEABLE. Do not.
 *
 * Exact equality is kept as a second accepted path, so this still
 * works if the injected value ever becomes something a caller can
 * present.
 */
function isServiceRole(req: Request): boolean {
  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!presented) return false;
  if (presented === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  try {
    const payload = presented.split(".")[1];
    if (!payload) return false;
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return claims?.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  // SERVICE ROLE ONLY. A signed-in user's token is also a valid JWT,
  // and this endpoint must not be something any user can trigger: it
  // talks to Apple on the project's behalf, with the project's
  // signing key.
  if (!isServiceRole(req)) return json(403, { error: "service role only" });
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const conf = readConfig();
  if ("missing" in conf) {
    console.error("[apple-revoke] missing secrets:", conf.missing.join(", "));
    return json(500, { error: `not configured: ${conf.missing.join(", ")}` });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, service);
  const { data: queued, error } = await db
    .from("apple_revocations")
    // `*`, NOT a column list. Naming `attempts` and `last_attempt_at`
    // makes PostgREST reject the whole query with "column does not
    // exist" until the SQL file has been applied — which defeats the
    // point of tolerating both schemas. Measured: the first deploy of
    // this returned 500 for exactly that reason.
    .select("*")
    .is("revoked_at", null)
    .order("queued_at", { ascending: true })
    .limit(BATCH);
  if (error) return json(500, { error: error.message });

  // BACKOFF IS APPLIED HERE RATHER THAN IN THE QUERY, on purpose: the
  // `attempts` and `last_attempt_at` columns arrive in a SQL file the
  // owner runs by hand, and a function and a schema never land in the
  // same instant. Filtering in JS means this behaves identically
  // before and after that file is applied — a missing column reads as
  // undefined, which is the same as "never attempted".
  const now = Date.now();
  const pending = (queued ?? []).filter((r) => {
    const last = r.last_attempt_at ? Date.parse(r.last_attempt_at) : 0;
    return now - last >= RETRY_AFTER_MS;
  });

  let revoked = 0;
  const failed: number[] = [];
  for (const row of pending) {
    const result = await revokeToken(conf.config, row.refresh_token);
    // Bookkeeping is a SEPARATE, best-effort write for the same
    // reason: if the columns are not there yet it fails and nothing
    // else is affected. It must never stand between a revocation and
    // the row being marked done.
    void db.from("apple_revocations")
      .update({ attempts: (row.attempts ?? 0) + 1, last_attempt_at: new Date().toISOString() })
      .eq("id", row.id);

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
      // LEFT IN THE QUEUE, deliberately, and RETRIED rather than
      // dropped. A failure here means Apple still believes the grant
      // is live; dropping the row would make that permanent and
      // invisible. The hour of backoff keeps a token Apple will not
      // accept from hammering them on every run, and from crowding
      // newer rows out of the batch.
      await db.from("apple_revocations").update({ last_error: result.error.slice(0, 500) }).eq("id", row.id);
      failed.push(row.id);
    }
  }

  return json(200, {
    queued: queued?.length ?? 0,
    attempted: pending.length,
    revoked,
    failed,
    // Rows that exist but are inside their backoff window. Saying so
    // is the difference between "nothing to do" and "nothing done".
    waiting: (queued?.length ?? 0) - pending.length,
  });
});
