// Pull a balance, if one is due, and write it as an ordinary snapshot.
//
// THE STALENESS CHECK IS PER ITEM AND IT LIVES HERE, not on a device.
// One pull serves every device the user is signed in on, which is the
// whole reason the clock is a column on `plaid_items` rather than
// something each client remembers. Two phones opening the app a minute
// apart make one call to Plaid.
//
// TRIGGERS:
//   open     -> pull only if the last one is older than 12 hours
//   refresh  -> the user asked. Capped at 4 a day, 60 seconds apart.
//
// Deploy:
//   npx supabase functions deploy plaid-balance --project-ref <ref>
import {
  BALANCE_STALE_AFTER_HOURS, MAX_MANUAL_REFRESHES_PER_DAY, REFRESH_DEBOUNCE_SECONDS,
  PLAID_ENDPOINTS, callPlaid, localDateIn, needsReconnect, readConfig,
} from "../_shared/plaid.ts";
import { adminClient, callerId, isAllowlisted, responder } from "../_shared/caller.ts";
import { preflight } from "../_shared/cors.ts";

interface BalanceResult {
  accounts?: Array<{
    account_id: string;
    balances?: { available?: number | null; current?: number | null };
  }>;
}

/**
 * Write a balance as an ordinary snapshot, through the one statement
 * that owns the collision rule.
 *
 * Shared by the pull and by "Use bank balance", so the two cannot
 * disagree about where a balance goes or how it is keyed. The only
 * difference between them is `force` — which is the user saying
 * "yes, really, use the bank's number", and is therefore the same
 * rule rather than an exception to it: manual wins because the
 * user's intent wins.
 */
// deno-lint-ignore no-explicit-any
async function writeBalance(admin: any, userId: string, account: { plaid_account_id: string },
  amount: number, timeZone: string | null, force: boolean) {
  // Which checking account of OURS this balance belongs to. The
  // snapshot is keyed by it, because the Ledger reads snapshots and
  // has never heard of Plaid.
  const { data: ours } = await admin
    .from("budget_entities").select("entity_id, data")
    .eq("user_id", userId).eq("kind", "account").is("deleted_at", null);
  const checking = (ours ?? []).find((r: { data?: { kind?: string } }) => r.data?.kind === "checking") ?? (ours ?? [])[0];
  if (!checking) return { ok: false as const, reason: "no_local_account" };

  const { data: applied } = await admin.rpc("plaid_write_balance", {
    p_user_id: userId,
    p_account_id: checking.data?.id ?? checking.entity_id,
    // The user's day, falling back to the zone we last stored and
    // then to UTC. Never the server's day when we know better.
    p_date: localDateIn(timeZone),
    p_amount: amount,
    p_external_id: account.plaid_account_id,
    p_force: force,
  });
  return { ok: true as const, applied: applied as string };
}

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
    console.error("[plaid-balance] missing secrets:", conf.missing.join(", "));
    return json(500, { error: `not configured: ${conf.missing.join(", ")}` });
  }

  const userId = await callerId(req);
  if (!userId) return json(401, { error: "not signed in" });

  const admin = adminClient();
  if (!await isAllowlisted(admin, userId)) return json(403, { error: "not available" });

  let payload: { trigger?: string; timeZone?: string } = {};
  try { payload = await req.json(); } catch { /* defaults to open */ }
  // THREE TRIGGERS NOW. `adopt` is "Use bank balance": the user is
  // dropping their own figure for today in favor of the last one the
  // bank gave us. IT MAKES NO PLAID CALL and costs nothing — the
  // number is already on `plaid_accounts`, and charging a billed
  // request to undo somebody's own typing would be absurd.
  const trigger = payload.trigger === "refresh" ? "refresh"
    : payload.trigger === "adopt" ? "adopt"
    : payload.trigger === "reconnect" ? "reconnect"
    : "open";
  // The client's IANA zone, so the snapshot is dated in the user's
  // own day rather than the server's. See localDateIn.
  const timeZone = typeof payload.timeZone === "string" ? payload.timeZone : null;

  const { data: item } = await admin
    .from("plaid_items")
    .select("id, status, last_synced_at, plaid_item_id, time_zone")
    .eq("user_id", userId)
    .maybeSingle();
  // Not connected is not an error. Manual entry is the product; this
  // endpoint being asked by someone with no bank is an ordinary thing
  // for a client to do on open.
  if (!item) return json(200, { connected: false });

  // REMEMBERED, not just used. The pulls in the roadmap that no
  // client initiates have nobody to ask, so the last zone a real
  // device reported is the best answer available to them.
  if (timeZone && timeZone !== item.time_zone) {
    await admin.from("plaid_items").update({ time_zone: timeZone }).eq("id", item.id);
  }

  // A PULL IS WHAT PROVES A RECONNECT WORKED. `reconnect` is the one
  // trigger allowed past this gate: the user has just come back from
  // Link in update mode, and the only honest test of whether that
  // took is asking the bank. If it did not, the call below fails with
  // ITEM_LOGIN_REQUIRED again and the status is written straight
  // back — so nothing here can clear the flag by assertion.
  if (item.status === "login_required" && trigger !== "reconnect") {
    return json(200, { connected: true, status: "login_required", synced: false, last_synced_at: item.last_synced_at });
  }

  const now = Date.now();

  const { data: account } = await admin
    .from("plaid_accounts").select("id, plaid_account_id, last_available")
    .eq("item_id", item.id).eq("is_checking", true).maybeSingle();

  // ---- "Use bank balance": no Plaid call, no cost, no cap ----
  if (trigger === "adopt") {
    if (!account || account.last_available == null) {
      return json(200, { connected: true, synced: false, reason: "no_balance", last_synced_at: item.last_synced_at });
    }
    const adopted = await writeBalance(admin, userId, account, Number(account.last_available),
      timeZone ?? item.time_zone, true);
    if (!adopted.ok) return json(200, { connected: true, synced: false, reason: adopted.reason, last_synced_at: item.last_synced_at });
    return json(200, { connected: true, status: item.status, synced: true, applied: adopted.applied, last_synced_at: item.last_synced_at });
  }

  if (trigger === "refresh") {
    // THE CAP COUNTS CALLS THAT WERE MADE, out of the same log that
    // answers "pulls per user per month". A cap counted anywhere else
    // would be a second opinion about the same number.
    const since = new Date(now - 24 * 3600_000).toISOString();
    const { count } = await admin
      .from("plaid_api_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("trigger", "refresh")
      .eq("endpoint", PLAID_ENDPOINTS.accountsBalanceGet)
      .gte("called_at", since);
    if ((count ?? 0) >= MAX_MANUAL_REFRESHES_PER_DAY) {
      return json(200, { connected: true, status: item.status, synced: false, reason: "daily_cap", last_synced_at: item.last_synced_at });
    }
  }

  // ---- CLAIM THE PULL, which IS the staleness check ----
  //
  // ONE STATEMENT, so two callers cannot both pass it. One connect
  // billed two pulls on 2026-10-20 because the connect flow pulled
  // as soon as the Item existed and the app's own pull-on-open fired
  // three seconds later when the page noticed a connection had
  // appeared: both read `last_synced_at`, both saw it empty, both
  // called Plaid. Reading and then writing cannot be made safe by
  // being careful. It is also what makes "one pull serves every
  // device" true when two phones open in the same second.
  // A reconnect is debounced like a refresh and capped like neither:
  // somebody repairing a broken connection must not be told to come
  // back tomorrow because they spent today's four refreshes watching
  // it fail.
  const minSeconds = trigger === "refresh" || trigger === "reconnect"
    ? REFRESH_DEBOUNCE_SECONDS
    : BALANCE_STALE_AFTER_HOURS * 3600;
  const { data: claim } = await admin.rpc("plaid_claim_pull", { p_item_id: item.id, p_min_seconds: minSeconds });
  const got = Array.isArray(claim) ? claim[0] : claim;
  if (!got?.claimed) {
    return json(200, {
      connected: true, status: item.status, synced: false,
      reason: trigger === "refresh" || trigger === "reconnect" ? "just_now" : "fresh",
      last_synced_at: item.last_synced_at,
    });
  }
  // Claiming wrote `now()` up front, so every path out of here that
  // is not a successful pull has to put the clock back — or a failed
  // pull leaves the Item looking synced.
  const previousSync: string | null = got.previous ?? null;
  const release = () => admin.rpc("plaid_release_pull", { p_item_id: item.id, p_previous: previousSync });

  // The one path from ciphertext to plaintext, and it is a function
  // call rather than a select: the token is encrypted at rest and
  // `plaid_tokens` holds only a Vault secret id.
  const { data: accessToken } = await admin.rpc("plaid_read_token", { p_item_id: item.id });
  if (!accessToken) {
    console.error("[plaid-balance] item with no readable token:", item.id);
    await release();
    return json(200, { ok: false, code: "NO_TOKEN" });
  }

  const result = await callPlaid<BalanceResult>(conf.config, PLAID_ENDPOINTS.accountsBalanceGet,
    { access_token: accessToken }, { admin, userId, trigger });

  if ("error" in result) {
    const reconnect = needsReconnect(result.error.code);
    // A FROZEN NUMBER THAT LOOKS LIVE IS WORSE THAN NO NUMBER. The
    // status is written so the pill can say Reconnect instead of
    // going on showing a date that will never move again.
    // The clock goes back FIRST, so the status write below is not
    // undone by it and a failed pull never looks synced.
    await release();
    await admin.from("plaid_items")
      .update({ status: reconnect ? "login_required" : "error", last_error_code: result.error.code, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    return json(200, {
      connected: true, synced: false,
      status: reconnect ? "login_required" : "error",
      code: result.error.code, last_synced_at: item.last_synced_at,
    });
  }

  const fromPlaid = (result.data.accounts ?? []).find((a) => a.account_id === account?.plaid_account_id)
    ?? result.data.accounts?.[0];
  if (!account || !fromPlaid) { await release(); return json(200, { connected: true, synced: false, reason: "no_account" }); }

  // AVAILABLE IS THE NUMBER, with current as the fallback only when
  // the institution does not report one. Available nets pending holds,
  // which is nearer to what the next two weeks can actually spend —
  // and it is the only balance a user is ever shown, so there is no
  // "which one is mine" to answer.
  const available = fromPlaid.balances?.available ?? fromPlaid.balances?.current ?? null;
  const current = fromPlaid.balances?.current ?? null;
  if (available === null) { await release(); return json(200, { connected: true, synced: false, reason: "no_balance" }); }

  await admin.from("plaid_accounts")
    .update({ last_available: available, last_current: current, last_balance_at: new Date().toISOString() })
    .eq("id", account.id);

  const written = await writeBalance(admin, userId, account, available, timeZone ?? item.time_zone, false);
  if (!written.ok) { await release(); return json(200, { connected: true, synced: false, reason: written.reason }); }
  const wrote = written.applied;

  const syncedAt = new Date().toISOString();
  await admin.from("plaid_items")
    .update({ status: "ok", last_error_code: null, last_synced_at: syncedAt, updated_at: syncedAt })
    .eq("id", item.id);

  return json(200, {
    connected: true, status: "ok", synced: true,
    // 'written' or 'kept_manual' — the pill says "logged today" rather
    // than claiming a sync it did not apply.
    applied: wrote,
    last_synced_at: syncedAt,
  });
});
