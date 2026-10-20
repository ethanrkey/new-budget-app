// Who is calling, and the two clients every Plaid function needs.
//
// Shared because getting this wrong once is a breach: the user id must
// come from the caller's own JWT, never from the request body. A user
// id in a payload is a user id anyone can type.
import { createClient } from "jsr:@supabase/supabase-js@2";

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The service-role client. Bypasses RLS; never handed anything from a request. */
export const adminClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/** The signed-in user, proved against their own token. */
export async function callerId(req: Request): Promise<string | null> {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization) return null;
  const asUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error } = await asUser.auth.getUser();
  return error || !user ? null : user.id;
}

/**
 * Is this caller allowed to see connected features at all?
 *
 * Checked on EVERY function and not only at the toggle. The toggle is
 * a drawing decision; this is the gate. A feature gated only in the
 * UI is not gated.
 *
 * AND IT STAYS ON AT PUBLIC LAUNCH, 2026-10-20. Plaid's Trial terms
 * limit live connections to people the owner personally knows, so
 * this is not a beta flag that gets switched off when the app ships —
 * it is a term of the plan, and it comes off when the plan does.
 * Anyone not on the list sees no toggle, no entry point, and an
 * ordinary, complete, manual app.
 */
// deno-lint-ignore-next-line no-explicit-any
export async function isAllowlisted(admin: { from: (t: string) => any }, userId: string): Promise<boolean> {
  const { data } = await admin.from("plaid_beta").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}
