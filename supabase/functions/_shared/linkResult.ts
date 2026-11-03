// WHAT A HOSTED LINK SESSION PRODUCED, read from /link/token/get.
//
// Free of Deno APIs, so tests/edge-functions.test.mjs imports it.
//
// 2026-11-03, production: Capital One over OAuth from iOS. Every Plaid
// step finished; the app came back to "Connect your bank". The
// exchange read ONE place, `link_sessions[0].results.item_add_results[0]`,
// and on finding nothing there closed the session as "finished with no
// item", which also put it beyond `recover`'s reach for good.
//
// One link token can carry MORE THAN ONE link session (an OAuth bank
// sends the user away to the bank and back), and Plaid does not promise
// which is first. The results can also lag the ITEM_ADD_RESULT webhook
// that announced them. So:
//
//   - look in EVERY session, newest result first, and in the older
//     `on_success.public_token` field as well;
//   - an empty answer is "not yet", NOT "nothing happened", unless a
//     session says the user exited and none of them has an Item.

export interface LinkSessions {
  link_sessions?: Array<{
    link_session_id?: string;
    started_at?: string;
    finished_at?: string | null;
    results?: { item_add_results?: Array<{ public_token?: string }> } | null;
    on_success?: { public_token?: string } | null;
    exit?: unknown;
    on_exit?: unknown;
  }>;
}

/** The public token to exchange, or "" if no session has one yet. */
export function publicTokenOf(data: LinkSessions | null | undefined): string {
  const sessions = [...(data?.link_sessions ?? [])];
  // Newest first: a later session is the one that came back from the bank.
  sessions.sort((a, b) => String(b.finished_at ?? b.started_at ?? "").localeCompare(String(a.finished_at ?? a.started_at ?? "")));
  for (const s of sessions) {
    const fromResults = (s.results?.item_add_results ?? []).map((r) => r?.public_token).find((t) => typeof t === "string" && t);
    if (fromResults) return fromResults;
    const legacy = s.on_success?.public_token;
    if (typeof legacy === "string" && legacy) return legacy;
  }
  return "";
}

/**
 * True only when the user backed out: some session records an exit and
 * none produced an Item. Then, and only then, may an empty answer close
 * the session. Anything else (no sessions yet, a session still in
 * progress, results not written yet) leaves it open for `recover`.
 */
export function exitedWithNoItem(data: LinkSessions | null | undefined): boolean {
  const sessions = data?.link_sessions ?? [];
  if (!sessions.length || publicTokenOf(data)) return false;
  return sessions.some((s) => s.exit != null || s.on_exit != null);
}
