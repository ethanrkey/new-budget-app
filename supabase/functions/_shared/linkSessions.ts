// WHEN AN ITEM_ADD_RESULT WEBHOOK ARRIVED for each link token, read
// apart from the session's other columns.
//
// APART ON PURPOSE. `item_reported_at` is a column added on 2026-11-03
// (supabase/plaid.sql). Selected beside link_token and env, a database
// that has not had the ALTER yet would fail the whole read, and recover
// would answer "nothing open" over a session holding a live Item. Read
// alone, a missing column costs only this one piece of evidence.

// deno-lint-ignore no-explicit-any
export async function reportedAt(admin: any, linkTokens: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!linkTokens.length) return out;
  try {
    const { data, error } = await admin.from("plaid_link_sessions")
      .select("link_token, item_reported_at").in("link_token", linkTokens);
    if (error || !Array.isArray(data)) return out;
    for (const r of data) if (r?.item_reported_at) out.set(String(r.link_token), String(r.item_reported_at));
  } catch { /* evidence we cannot read is evidence we do not have */ }
  return out;
}

/** Mark that Plaid announced an Item for this session. Never throws. */
// deno-lint-ignore no-explicit-any
export async function noteItemReported(admin: any, linkToken: string): Promise<void> {
  try {
    await admin.from("plaid_link_sessions").update({ item_reported_at: new Date().toISOString() })
      .eq("link_token", linkToken).is("item_reported_at", null);
  } catch { /* see above */ }
}
