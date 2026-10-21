// Turn a finished Link session into a stored connection.
//
// TWO WAYS IN, one path:
//
//   web          POST { public_token } with the user's own JWT
//   Hosted Link  POST from Plaid: SESSION_FINISHED, naming a link_token
//
// Hosted Link has no frontend callback at all, which is the one real
// consequence of shipping iOS without the native SDK. It suits this
// feature rather than hurting it: the app never wants the token, and
// when the browser closes the client just re-reads its own connection.
//
// WHY A FORGED WEBHOOK CANNOT DO ANYTHING. The webhook body is a
// TRIGGER AND NOTHING ELSE. Nothing in it is stored. The handler looks
// the link_token up in `plaid_link_sessions` — a row only this app
// could have written — and then asks PLAID what happened, via
// /link/token/get. Someone who guesses a link_token can cause us to
// ask Plaid a question about our own session; they cannot tell us the
// answer.
//
// STILL OWED BEFORE PRODUCTION: Plaid's own `Plaid-Verification` JWT
// check. The design above means a forgery cannot plant data, but it
// can still make us spend a call, and the signature is the proper
// answer to that. Written down rather than quietly skipped.
//
// IT NEEDS CORS TOO, which is easy to talk yourself out of: this is
// "the webhook function", and a webhook is not a browser. But the WEB
// path above is a browser — `finishLink` in src/shared/plaidApi.ts
// posts the public_token straight from the page — and leaving CORS
// off here would have moved the failure from the FIRST step of
// connecting to the LAST, after the Item already existed at Plaid and
// this app had no record of it. That is strictly the worse place for
// it to break.
//
// Plaid's own webhook sends no Origin, takes the no-header path in
// _shared/cors.ts, and is unaffected by any of this.
//
// Deploy with JWT verification OFF — Plaid does not carry a Supabase
// token:
//   npx supabase functions deploy plaid-exchange --no-verify-jwt --project-ref <ref>
import { PLAID_ENDPOINTS, callPlaid, readConfig } from "../_shared/plaid.ts";
import { adminClient, callerId, isAllowlisted, responder } from "../_shared/caller.ts";
import { preflight } from "../_shared/cors.ts";

interface Exchanged { access_token: string; item_id: string }
interface LinkSession { link_sessions?: Array<{ results?: { item_add_results?: Array<{ public_token?: string }> } }> }
interface ItemGot { item?: { institution_id?: string } }
interface Institution { institution?: { name?: string } }
interface BalanceAccounts { accounts?: Array<{ account_id: string; name?: string; mask?: string; type?: string; subtype?: string }> }

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
    console.error("[plaid-exchange] missing secrets:", conf.missing.join(", "));
    return json(500, { error: `not configured: ${conf.missing.join(", ")}` });
  }

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* handled below */ }

  const admin = adminClient();
  let userId: string | null = null;
  let publicToken = "";
  let trigger = "connect";

  if (typeof payload.public_token === "string" && payload.public_token) {
    // ---- the web path: an authenticated client hands us the token ----
    userId = await callerId(req);
    if (!userId) return json(401, { error: "not signed in" });
    if (!await isAllowlisted(admin, userId)) return json(403, { error: "not available" });
    publicToken = payload.public_token;
  } else if (payload.webhook_code === "SESSION_FINISHED") {
    // ---- the Hosted Link path: Plaid tells us a session ended ----
    trigger = "webhook";
    const linkToken = String(payload.link_token ?? "");
    if (!linkToken) return json(200, { ignored: "no link_token" });

    const { data: session } = await admin
      .from("plaid_link_sessions")
      .select("user_id")
      .eq("link_token", linkToken)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    // A link_token we did not mint, or one already spent. 200, because
    // a webhook that gets a 4xx is retried, and there is nothing here
    // worth retrying.
    if (!session) return json(200, { ignored: "unknown session" });
    userId = session.user_id;

    // THE ANSWER COMES FROM PLAID, NOT FROM THE REQUEST. This is the
    // line the paragraph at the top of the file is about.
    const got = await callPlaid<LinkSession>(conf.config, PLAID_ENDPOINTS.linkTokenGet,
      { link_token: linkToken }, { admin, userId, trigger });
    if ("error" in got) return json(200, { ignored: "link/token/get failed", code: got.error.code });

    publicToken = got.data.link_sessions?.[0]?.results?.item_add_results?.[0]?.public_token ?? "";
    // A session can finish without an Item — the user backed out. That
    // is a completed session, not a failure, and nothing is stored.
    if (!publicToken) {
      await admin.from("plaid_link_sessions").update({ used_at: new Date().toISOString() }).eq("link_token", linkToken);
      return json(200, { ignored: "session finished with no item" });
    }
    await admin.from("plaid_link_sessions").update({ used_at: new Date().toISOString() }).eq("link_token", linkToken);
  } else {
    // Every other webhook Plaid sends. Acknowledged and dropped: an
    // unhandled webhook that 400s gets retried for days.
    return json(200, { ignored: String(payload.webhook_code ?? "no public_token") });
  }

  // ---- from here the two paths are the same ----
  const exchanged = await callPlaid<Exchanged>(conf.config, PLAID_ENDPOINTS.itemPublicTokenExchange,
    { public_token: publicToken }, { admin, userId, trigger });
  // A HANDLED FAILURE IS A 200, not a 502. supabase-js turns any
  // non-2xx into a thrown FunctionsHttpError whose body the caller
  // has to go digging for, so a 502 reaches the page as "something
  // exploded" with the actual Plaid code buried. This is a request
  // that was understood and did not work, and the client needs the
  // code more than it needs the status.
  if ("error" in exchanged) return json(200, { ok: false, code: exchanged.error.code });

  const { access_token, item_id } = exchanged.data;

  // THE NET GOES UP HERE, one line after Plaid starts believing we
  // have access to someone's bank and before anything else can fail.
  // If the rest of this function does not reach its last line — a
  // failed insert, a timeout, a process killed mid-flight — the
  // drain removes this Item within the hour. Canceled on success.
  // See plaid_queue_removal in supabase/plaid.sql.
  const { data: safetyNet } = await admin.rpc("plaid_queue_removal", {
    p_access_token: access_token, p_plaid_item_id: item_id,
  });
  const standDown = async () => {
    if (safetyNet != null) await admin.rpc("plaid_cancel_removal", { p_id: safetyNet });
  };

  // The bank's name, for Settings. Two calls, both read-only, both
  // about the institution rather than the person.
  let institutionId: string | null = null;
  let institutionName: string | null = null;
  const item = await callPlaid<ItemGot>(conf.config, PLAID_ENDPOINTS.itemGet, { access_token }, { admin, userId, trigger });
  if (!("error" in item) && item.data.item?.institution_id) {
    institutionId = item.data.item.institution_id;
    const inst = await callPlaid<Institution>(conf.config, PLAID_ENDPOINTS.institutionsGetById,
      { institution_id: institutionId, country_codes: ["US"] }, { admin, userId, trigger });
    if (!("error" in inst)) institutionName = inst.data.institution?.name ?? null;
  }

  const { data: row, error: insertError } = await admin.from("plaid_items").insert({
    user_id: userId, plaid_item_id: item_id,
    institution_id: institutionId, institution_name: institutionName,
  }).select("id").single();

  if (insertError || !row) {
    // The net is already up, so this branch does not have to clean
    // anything up — it just has to not stand it down.
    console.error("[plaid-exchange] could not store item:", insertError?.message);
    return json(200, { ok: false, code: "STORE_FAILED" });
  }

  // THROUGH THE VAULT, never as a column. `plaid_store_token`
  // encrypts it with a key SQL cannot read; `plaid_tokens` holds a
  // uuid. This is also why it is an RPC and not an insert: a plain
  // INSERT of the token would be written to the Supabase statement
  // log in clear. See supabase/plaid.sql.
  const { error: tokenError } = await admin.rpc("plaid_store_token", {
    p_item_id: row.id, p_access_token: access_token,
  });
  if (tokenError) {
    // Same again: leave the net up and take our own half-written row
    // back out, so the user is not shown a connection with no token
    // behind it.
    console.error("[plaid-exchange] could not store token:", tokenError.message);
    await admin.from("plaid_items").delete().eq("id", row.id);
    return json(200, { ok: false, code: "STORE_FAILED" });
  }

  // Which account was picked. Read from the balance endpoint because
  // it is the one we are allowed to call; /accounts/get would do the
  // same job and is not on the list.
  const accounts = await callPlaid<BalanceAccounts>(conf.config, PLAID_ENDPOINTS.accountsBalanceGet,
    { access_token }, { admin, userId, trigger });
  if (!("error" in accounts)) {
    const rows = (accounts.data.accounts ?? []).map((a) => ({
      item_id: row.id, user_id: userId, plaid_account_id: a.account_id,
      name: a.name ?? null, mask: a.mask ?? null, type: a.type ?? null, subtype: a.subtype ?? null,
      is_checking: true,
    }));
    if (rows.length) await admin.from("plaid_accounts").insert(rows);
  }

  // THE ITEM AND ITS TOKEN ARE STORED. An orphan is no longer
  // possible, so the net comes down — and it comes down HERE, after
  // the accounts read, because a connection with no account row is
  // still a connection we can remove on request.
  await standDown();

  return json(200, { ok: true, connected: true, institution_name: institutionName });
});
