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
// AND THE WEBHOOK IS NOW SIGNATURE-CHECKED (2026-10-21), which the
// paragraph above used to say was still owed. The design meant a
// forgery could not plant data; it could still make us spend calls,
// and on a plan billed per request with ten Items for life that is
// worth closing. See _shared/webhookVerify.ts for the algorithm and
// for why the raw body text is read once and parsed afterwards.
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
import { type PlaidJwk, verifyPlaidWebhook } from "../_shared/webhookVerify.ts";

/**
 * Verification keys, by `kid`.
 *
 * ONE EXTRA PLAID CALL PER WEBHOOK WITHOUT THIS, which is the sort
 * of cost that arrives as a bill rather than a bug. Module scope, so
 * it lives as long as the isolate and no longer — a cold start
 * fetches once and that is the correct amount of caching for
 * something that must never serve a key Plaid has retired.
 *
 * ONLY LIVE KEYS ARE CACHED. A key with `expired_at` set is refused
 * by the verifier and must not be remembered, or a rotation would be
 * pinned in memory until the isolate died.
 */
const keyCache = new Map<string, PlaidJwk>();

/**
 * Write down that a webhook ARRIVED, and what we decided about it.
 *
 * `console.error` was the only record, and on 2026-10-21 that turned
 * out to be no record at all: a real TD Bank connection never
 * reached us, and the question "did the webhook arrive and get
 * refused, or did it never arrive?" could not be answered — this
 * CLI has no `functions logs`, and reading the dashboard is not
 * something a test can do. The difference between those two answers
 * is the difference between a bug in our verifier and a bug in the
 * delivery, so it has to land somewhere a query can reach.
 *
 * It goes in `plaid_api_log` rather than a new table, so nobody has
 * to re-run the schema to get the evidence. INBOUND rows are marked
 * as such: trigger `webhook-in`, endpoint `(inbound) <code>`, and
 * `ok` is whether we accepted it. Still no bodies and no balances —
 * the rule for that table is unchanged.
 */
// deno-lint-ignore no-explicit-any
async function noteInbound(admin: any, code: string, verdict: string, type = "") {
  try {
    await admin.from("plaid_api_log").insert({
      user_id: null, trigger: "webhook-in",
      // THE TYPE AS WELL AS THE CODE. "Which webhook was that?" was
      // the question nobody could answer on 2026-10-21, and
      // webhook_type is half the answer: LINK/ITEM_ADD_RESULT and
      // ITEM/ERROR are different things that a bare code hides.
      endpoint: `(inbound) ${type ? `${type}/` : ""}${code}`,
      ok: verdict === "verified", error_code: verdict === "verified" ? null : verdict,
    });
  } catch { /* a log that fails must never fail the thing it logs */ }
}

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

  // THE RAW TEXT, READ ONCE. The signature is over these exact
  // bytes, so a JSON.parse followed by a re-stringify would be a
  // different string the moment Plaid puts a space where we would
  // not. Parsed afterwards, from the same text.
  let raw = "";
  try { raw = await req.text(); } catch { /* handled below */ }
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(raw); } catch { /* handled below */ }

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
    // THE WEB PATH CLOSES ITS SESSION AT THE END, not here.
    //
    // It closed it here first, so that the ten-minute Trial-slot
    // reservation in plaid-link-token would not hold Connect shut
    // straight after a success. But a session marked used is a
    // session `recover` can no longer find — so a tab closed in the
    // middle of the exchange would have stranded the Item with no
    // way back, which is the exact failure this whole batch exists
    // to remove. The reservation keys on `created_at`, so leaving
    // the row open costs at most those ten minutes.
  } else if (payload.webhook_code === "SESSION_FINISHED" || payload.webhook_code === "ITEM_ADD_RESULT") {
    // ---- the Hosted Link path: Plaid tells us an Item appeared ----
    //
    // BOTH CODES, and ITEM_ADD_RESULT is the one that matters.
    //
    // This matched SESSION_FINISHED alone, on the reasoning that a
    // finished session is when there is something to collect. On
    // 2026-10-21 a real TD Bank connection produced THREE webhook
    // invocations in the ninety seconds after the user finished —
    // and none of them was SESSION_FINISHED, so all three fell
    // through to the 200-and-ignore at the bottom of this function
    // and the Item was lost. The dashboard logs showed the boots;
    // nothing else showed anything, which is why `noteInbound`
    // exists now.
    //
    // Plaid's docs are plain about it: ITEM_ADD_RESULT fires for
    // EACH Item added in a Hosted Link session, so the caller can
    // act as each one arrives, while SESSION_FINISHED waits for the
    // user to finish or exit the whole session — which, in an
    // in-app browser the user simply closes, may be much later or
    // not at all. The per-Item webhook is the primary one for this
    // flow and the session one is the sweep-up.
    //
    // ITEM_ADD_RESULT carries a `public_token` in the body. IT IS
    // STILL NOT READ FROM THERE. The body is a trigger and the
    // answer comes from /link/token/get, which is what keeps a
    // forgery able only to make us ask Plaid a question. The
    // signature check makes the body trustworthy now; one extra
    // call is a small price for not having to rely on that being
    // true forever.
    trigger = "webhook";

    // IS IT FROM PLAID. Before the table lookup, before the
    // link/token/get, before anything that costs a call — which is
    // the whole reason the check is worth having, given a forgery
    // could never plant data in the first place.
    const verified = await verifyPlaidWebhook({
      header: req.headers.get("Plaid-Verification"),
      body: raw,
      fetchKey: async (keyId) => {
        const cached = keyCache.get(keyId);
        if (cached) return cached;
        const got = await callPlaid<{ key?: PlaidJwk }>(
          conf.config, PLAID_ENDPOINTS.webhookVerificationKeyGet,
          { key_id: keyId }, { admin, userId: null, trigger: "verify" },
        );
        if ("error" in got || !got.data.key) return null;
        // Live keys only — see the cache's note.
        if (got.data.key.expired_at == null) keyCache.set(keyId, got.data.key);
        return got.data.key;
      },
    });
    if (!verified.ok) {
      // 401 AND NOT A QUIET 200. Everything else in this function
      // answers 200-and-ignore so Plaid stops retrying, but an
      // unverified webhook is the one case where a retry is wanted:
      // if this ever fires on a real one, iOS Connect is broken and
      // the log should say so loudly rather than look like silence.
      console.error("[plaid-exchange] webhook refused:", verified.reason);
      await noteInbound(admin, String(payload.webhook_code), verified.reason, String(payload.webhook_type ?? ""));
      return json(401, { error: "unverified", reason: verified.reason });
    }
    await noteInbound(admin, String(payload.webhook_code), "verified", String(payload.webhook_type ?? ""));
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
  } else if (payload.recover === true) {
    // ---- FINISH A SESSION THE WEBHOOK NEVER FINISHED ----
    //
    // HOSTED LINK HAD EXACTLY ONE COMPLETION PATH and that was a
    // mistake. The webhook is a message from a third party over the
    // public internet; it can be late, lost, or refused by a bug in
    // our own verifier — and when it is, the user is left with a
    // LIVE ITEM AT PLAID and no record of it here. On a plan with
    // ten Items for life that is not an inconvenience, it is a spent
    // slot, and the only way out the user can find is a second Link.
    //
    // So the client asks directly instead of waiting to be told. It
    // is the same question the webhook triggers — "what happened in
    // my session?" — asked OF Plaid rather than received from it,
    // which was always the trustworthy half of the webhook design.
    //
    // Found the hard way, 2026-10-21: a real TD Bank connection in
    // production completed at Plaid and never arrived here.
    trigger = "recover";

    // THE CALLER'S OWN JWT AND NOTHING ELSE. An operator door keyed
    // on the service-role key was written during the 2026-10-21
    // rescue and is gone: the key in .env.local did not match what
    // the function sees in its own environment, and the next idea —
    // keying the rescue on the link token — was refused by the
    // permission classifier as weakening security, correctly. It
    // would have been an unauthenticated way to exchange a bank
    // token. The user's own session is the right credential and it
    // is one request.
    userId = await callerId(req);
    if (!userId) return json(401, { error: "not signed in" });
    if (!await isAllowlisted(admin, userId)) return json(403, { error: "not available" });

    const { data: open } = await admin
      .from("plaid_link_sessions")
      .select("link_token")
      .eq("user_id", userId)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Nothing unfinished is the ordinary answer, not an error: it is
    // what the client sees every time the webhook DID arrive first.
    if (!open) return json(200, { ok: false, code: "NO_OPEN_SESSION" });

    const got = await callPlaid<LinkSession>(conf.config, PLAID_ENDPOINTS.linkTokenGet,
      { link_token: open.link_token }, { admin, userId, trigger });
    if ("error" in got) return json(200, { ok: false, code: got.error.code });

    publicToken = got.data.link_sessions?.[0]?.results?.item_add_results?.[0]?.public_token ?? "";
    await admin.from("plaid_link_sessions").update({ used_at: new Date().toISOString() })
      .eq("link_token", open.link_token);
    // A session that finished with no Item — the user backed out.
    // Closed above either way, so the Trial-slot reservation in
    // plaid-link-token stops holding Connect shut.
    if (!publicToken) return json(200, { ok: false, code: "NO_ITEM_IN_SESSION" });
  } else {
    // Every other webhook Plaid sends. Acknowledged and dropped: an
    // unhandled webhook that 400s gets retried for days.
    //
    // RECORDED FIRST, though, because "nothing from Plaid ever
    // arrives here" and "the one we wanted was refused" look
    // identical from the database otherwise.
    if (typeof payload.webhook_code === "string") {
      await noteInbound(admin, payload.webhook_code, "unhandled", String(payload.webhook_type ?? ""));
    }
    //
    // DELIBERATELY NOT VERIFIED. Verification costs a Plaid call on
    // a cold isolate, and this branch reads nothing, writes nothing
    // and calls nothing — paying to authenticate a request before
    // throwing it away is the wrong way round. The branch above,
    // which spends calls, is verified before it spends any.
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

  // THE SLOT LEDGER, which nothing ever deletes from.
  //
  // Plaid's Trial is TEN PRODUCTION ITEMS EVER and `/item/remove`
  // does not refund one, so `plaid_items` — emptied by every
  // disconnect — cannot answer "how many have we spent". This can.
  // Written after the row and the token, so it counts Items this app
  // actually kept, and failing to write it does not fail the
  // connection: a miscount is worth less than a working bank.
  const { error: ledgerError } = await admin.from("plaid_item_creations").insert({
    plaid_item_id: item_id,
    institution_name: institutionName,
    env: conf.config.env,
  });
  if (ledgerError) console.error("[plaid-exchange] slot ledger write failed:", ledgerError.message);

  // THE ITEM AND ITS TOKEN ARE STORED. An orphan is no longer
  // possible, so the net comes down — and it comes down HERE, after
  // the accounts read, because a connection with no account row is
  // still a connection we can remove on request.
  await standDown();

  // AND NOW the session is spent — after the Item, the token and the
  // accounts are all stored, so nothing that fails before this point
  // can put a connection out of `recover`'s reach.
  await admin.from("plaid_link_sessions")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", userId).is("used_at", null);

  return json(200, { ok: true, connected: true, institution_name: institutionName });
});
