// Mint a Link token for the signed-in user, and record that we did.
//
// TWO SHAPES OUT OF ONE CALL, because the two clients open Link
// differently and the server side is identical either way:
//
//   web  -> `link_token`, handed to Plaid Link JS
//   iOS  -> `hosted_link_url`, opened in expo-web-browser
//
// iOS uses Hosted Link because the native SDK is native code and the
// owner is out of EAS builds. `expo-web-browser` is already in build
// 13, so this ships over the air. When the next binary lands, iOS
// switches to the native SDK and NOTHING HERE CHANGES — the swap is
// the opening gesture and nothing else.
//
// Deploy:
//   npx supabase functions deploy plaid-link-token --project-ref <ref>
// JWT verification stays ON: this mints a credential tied to a user.
import {
  PRODUCTS, ACCOUNT_FILTERS, PLAID_ENDPOINTS, callPlaid, defaultEnv, readConfig,
} from "../_shared/plaid.ts";
import { adminClient, callerId, isAllowlisted, responder } from "../_shared/caller.ts";
import { preflight } from "../_shared/cors.ts";

interface LinkTokenCreated { link_token: string; hosted_link_url?: string; expiration: string }

Deno.serve(async (req) => {
  // BEFORE THE METHOD CHECK, not after: a preflight is an OPTIONS
  // request, so a handler that answers 405 first kills the real POST
  // that would have followed.
  const pre = preflight(req);
  if (pre) return pre;

  const json = responder(req);
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const userId = await callerId(req);
  if (!userId) return json(401, { error: "not signed in" });

  const admin = adminClient();
  if (!await isAllowlisted(admin, userId)) return json(403, { error: "not available" });

  let body: { hosted?: boolean; update?: boolean } = {};
  try { body = await req.json(); } catch { /* an empty body means web */ }

  const { data: existing } = await admin
    .from("plaid_items").select("id, status, env").eq("user_id", userId).maybeSingle();

  // WHICH ENVIRONMENT. An existing Item's own, because an access
  // token only works against the host it was minted for; otherwise
  // this person's default from the allowlist, and failing that the
  // project's. A per-user default is how one project serves a real
  // connection and a sandbox test account at the same time — see
  // readConfig and supabase/plaid.sql §5b.
  const { data: beta } = await admin
    .from("plaid_beta").select("env").eq("user_id", userId).maybeSingle();
  const env = existing?.env ?? beta?.env ?? defaultEnv();

  const conf = readConfig(env);
  if ("missing" in conf) {
    console.error("[plaid-link-token] missing secrets:", conf.missing.join(", "));
    return json(500, { error: `not configured: ${conf.missing.join(", ")}` });
  }

  // ---- UPDATE MODE: THE SAME ITEM, NOT A NEW ONE ----
  //
  // PLAID'S TRIAL IS TEN PRODUCTION ITEMS EVER and `/item/remove`
  // does not give one back, so a bank that needs signing in again
  // MUST be repaired in place. Disconnect-then-connect is a second
  // Item for the same account and costs a second slot out of ten.
  // That is what update mode is for: Link opens on the existing
  // access token, the user re-authenticates, and the Item, the
  // token and our row are all unchanged.
  //
  // `products` IS OMITTED, which is not a style choice — Plaid
  // rejects a token that carries both `access_token` and `products`.
  if (body.update) {
    if (!existing) return json(200, { ok: false, code: "NOT_CONNECTED" });
    const { data: accessToken } = await admin.rpc("plaid_read_token", { p_item_id: existing.id });
    if (!accessToken) return json(200, { ok: false, code: "NO_TOKEN" });

    const repaired = await callPlaid<LinkTokenCreated>(conf.config, PLAID_ENDPOINTS.linkTokenCreate, {
      user: { client_user_id: userId },
      client_name: "Key Budget",
      country_codes: ["US"],
      language: "en",
      access_token: accessToken,
      webhook: `${Deno.env.get("SUPABASE_URL")}/functions/v1/plaid-exchange`,
      ...(body.hosted ? { hosted_link: {} } : {}),
    }, { admin, userId, trigger: "reconnect" });
    if ("error" in repaired) return json(200, { ok: false, code: repaired.error.code });

    // DELIBERATELY NOT RECORDED IN plaid_link_sessions. That table
    // exists so the SESSION_FINISHED webhook can find out whose
    // public_token it is holding — and an update-mode session
    // produces no Item to exchange. A row here would invite the
    // exchange to run and create the very duplicate this branch is
    // avoiding.
    return json(200, {
      ok: true, update: true,
      link_token: repaired.data.link_token,
      hosted_link_url: repaired.data.hosted_link_url ?? null,
      expiration: repaired.data.expiration,
    });
  }

  // ONE CONNECTION PER USER today, enforced by an index on the table
  // as well as here. Checked before minting rather than after, so a
  // user who already has a bank is not walked through Link to be told
  // no at the end of it — which would be told no AFTER the Item, and
  // the slot, already existed at Plaid.
  if (existing) return json(200, { ok: false, code: "ALREADY_CONNECTED" });

  // AND NOT TWICE AT ONCE. Two tabs, or a double tap, mint two link
  // tokens while `plaid_items` is still empty, and both can finish:
  // the unique index refuses the second row and the safety net
  // removes the second Item — but the slot is spent either way,
  // because removal does not refund one. So an unfinished session
  // reserves the slot for ten minutes. Short on purpose: a user who
  // abandons Link should not be locked out of the feature for the
  // four hours a Plaid link token lives.
  const reserveFrom = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: inFlight } = await admin
    .from("plaid_link_sessions").select("link_token")
    .eq("user_id", userId).is("used_at", null)
    .gt("created_at", reserveFrom)
    .maybeSingle();
  if (inFlight) return json(200, { ok: false, code: "ALREADY_STARTING" });

  const created = await callPlaid<LinkTokenCreated>(conf.config, PLAID_ENDPOINTS.linkTokenCreate, {
    user: { client_user_id: userId },
    client_name: "Key Budget",
    // One product, and we never call its endpoint. See _shared/plaid.ts
    // for why an array that cannot be empty is the reason it is there.
    products: PRODUCTS,
    country_codes: ["US"],
    language: "en",
    // Checking only. Link shows nothing else, so nothing else can be
    // picked — the single-account rule is Link's, not a check we do
    // afterwards and hope held.
    account_filters: ACCOUNT_FILTERS,
    // Where SESSION_FINISHED lands. Required for Hosted Link, harmless
    // for web, and the same URL for both so there is one handler.
    webhook: `${Deno.env.get("SUPABASE_URL")}/functions/v1/plaid-exchange`,
    ...(body.hosted ? { hosted_link: {} } : {}),
  }, { admin, userId, trigger: "connect" });

  if ("error" in created) {
    // 200 with a code, not a 502 — see plaid-exchange for why: a
    // non-2xx becomes a thrown FunctionsHttpError and the page loses
    // the one piece of information worth having.
    return json(200, { ok: false, code: created.error.code });
  }

  // RECORDED BEFORE IT IS RETURNED, because the webhook will arrive
  // knowing only the link_token and this row is the only thing that
  // can say whose it is.
  // PINNED AT MINT. A session that outlives a change of default
  // still finishes in the environment it started in.
  await admin.from("plaid_link_sessions")
    .insert({ link_token: created.data.link_token, user_id: userId, env });

  return json(200, {
    ok: true,
    link_token: created.data.link_token,
    hosted_link_url: created.data.hosted_link_url ?? null,
    expiration: created.data.expiration,
  });
});
