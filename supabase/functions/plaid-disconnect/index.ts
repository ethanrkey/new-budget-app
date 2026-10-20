// End a connection, and drain the queue of connections whose owner is
// already gone.
//
// TWO CALLERS:
//   a signed-in user    POST {}            -> remove their own Item
//   cron, service role  POST {"drain":true} -> work plaid_removals
//
// WHAT DISCONNECTING DOES AND DOES NOT DO. It calls /item/remove,
// which is what actually ends Plaid's access to the bank, and deletes
// our token. IT KEEPS EVERY BALANCE ALREADY PULLED, as ordinary
// history — those snapshots are the user's own record of their own
// money, indistinguishable from ones they typed, and deleting them
// would punish someone for turning a feature off.
//
// Deleting our row without calling /item/remove would leave the Item
// live at Plaid: our record gone and the connection standing, which is
// the worst of both. That is why the queue exists for the case where
// the user is deleted before this runs.
//
// Deploy:
//   npx supabase functions deploy plaid-disconnect --project-ref <ref>
import { PLAID_ENDPOINTS, callPlaid, readConfig } from "../_shared/plaid.ts";
import { adminClient, callerId, responder } from "../_shared/caller.ts";
import { preflight } from "../_shared/cors.ts";

/** An hour between attempts on the same row, same as the Apple drain. */
const RETRY_AFTER_MS = 3600_000;

Deno.serve(async (req) => {
  // BEFORE THE METHOD CHECK, not after: a preflight is an OPTIONS
  // request, so a handler that answers 405 first kills the real POST
  // that would have followed.
  const pre = preflight(req);
  if (pre) return pre;

  const json = responder(req);
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const conf = readConfig();
  if ("missing" in conf) {
    console.error("[plaid-disconnect] missing secrets:", conf.missing.join(", "));
    return json(500, { error: `not configured: ${conf.missing.join(", ")}` });
  }

  let payload: { drain?: boolean } = {};
  try { payload = await req.json(); } catch { /* an empty body is a user disconnect */ }
  const admin = adminClient();

  // ---- the queue, for accounts that no longer have an owner ----
  if (payload.drain) {
    const cutoff = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
    const { data: pending } = await admin
      .from("plaid_removals")
      .select("id, attempts")
      .is("removed_at", null)
      .or(`last_attempt_at.is.null,last_attempt_at.lt.${cutoff}`)
      .limit(50);

    const failed: string[] = [];
    let removed = 0;
    for (const row of pending ?? []) {
      const { data: token } = await admin.rpc("plaid_read_removal_token", { p_id: row.id });
      if (!token) {
        // The ciphertext is gone but the row says pending. Nothing to
        // call /item/remove with, and nothing to retry for ever.
        await admin.from("plaid_removals")
          .update({ removed_at: new Date().toISOString(), last_error: "no secret" })
          .eq("id", row.id);
        continue;
      }
      // userId is null on purpose: the user is gone, and inventing an
      // id for the log would be a worse record than an honest absence.
      const res = await callPlaid(conf.config, PLAID_ENDPOINTS.itemRemove,
        { access_token: token }, { admin, userId: null, trigger: "disconnect" });
      if ("error" in res) {
        failed.push(res.error.code);
        await admin.from("plaid_removals")
          .update({ attempts: row.attempts + 1, last_attempt_at: new Date().toISOString(), last_error: res.error.code })
          .eq("id", row.id);
        continue;
      }
      removed++;
      // THE CIPHERTEXT IS DELETED, the row stays. It has done its only
      // job, and "did we actually remove this" keeps an answer. Same
      // shape as apple_revocations blanking its token column.
      await admin.rpc("plaid_finish_removal", { p_id: row.id });
    }
    return json(200, { queued: (pending ?? []).length, removed, failed });
  }

  // ---- a user turning it off ----
  const userId = await callerId(req);
  if (!userId) return json(401, { error: "not signed in" });

  const { data: item } = await admin
    .from("plaid_items").select("id, plaid_item_id").eq("user_id", userId).maybeSingle();
  // Already disconnected is a success. Disconnect is the button
  // someone presses when they want it gone; "there was nothing to
  // remove" is that wish granted.
  if (!item) return json(200, { disconnected: true });

  const { data: accessToken } = await admin.rpc("plaid_read_token", { p_item_id: item.id });

  if (accessToken) {
    const res = await callPlaid(conf.config, PLAID_ENDPOINTS.itemRemove,
      { access_token: accessToken }, { admin, userId, trigger: "disconnect" });
    if ("error" in res) {
      // THE USER'S SIDE STILL COMPLETES. Their rows go, and the token
      // goes to the queue to be retried — leaving the connection in
      // place because Plaid was briefly unreachable would mean a
      // Disconnect button that sometimes does nothing and says it
      // worked.
      await admin.rpc("plaid_queue_removal", { p_access_token: accessToken, p_plaid_item_id: item.plaid_item_id });
    } else {
      // Removed at Plaid, so the credential has no further use. The
      // Vault secret goes NOW rather than being orphaned by the
      // cascade on the next line.
      await admin.rpc("plaid_forget_token", { p_item_id: item.id });
    }
  }

  // Cascades plaid_tokens and plaid_accounts. Does NOT touch
  // budget_entities: the balances stay as history, which is the point.
  await admin.from("plaid_items").delete().eq("id", item.id);
  await admin.from("plaid_link_sessions").delete().eq("user_id", userId);

  return json(200, { disconnected: true });
});
