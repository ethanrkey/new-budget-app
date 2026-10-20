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
import { PRODUCTS, ACCOUNT_FILTERS, PLAID_ENDPOINTS, callPlaid, readConfig } from "../_shared/plaid.ts";
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

  const conf = readConfig();
  if ("missing" in conf) {
    console.error("[plaid-link-token] missing secrets:", conf.missing.join(", "));
    return json(500, { error: `not configured: ${conf.missing.join(", ")}` });
  }

  const userId = await callerId(req);
  if (!userId) return json(401, { error: "not signed in" });

  const admin = adminClient();
  if (!await isAllowlisted(admin, userId)) return json(403, { error: "not available" });

  // ONE CONNECTION PER USER today, enforced by an index on the table
  // as well as here. Checked before minting rather than after, so a
  // user who already has a bank is not walked through Link to be told
  // no at the end of it.
  const { data: existing } = await admin.from("plaid_items").select("id").eq("user_id", userId).maybeSingle();
  if (existing) return json(409, { error: "already connected" });

  let body: { hosted?: boolean } = {};
  try { body = await req.json(); } catch { /* an empty body means web */ }

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
    return json(502, { error: "could not start", code: created.error.code });
  }

  // RECORDED BEFORE IT IS RETURNED, because the webhook will arrive
  // knowing only the link_token and this row is the only thing that
  // can say whose it is.
  await admin.from("plaid_link_sessions").insert({ link_token: created.data.link_token, user_id: userId });

  return json(200, {
    link_token: created.data.link_token,
    hosted_link_url: created.data.hosted_link_url ?? null,
    expiration: created.data.expiration,
  });
});
