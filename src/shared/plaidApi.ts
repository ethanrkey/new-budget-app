// The four edge functions, from a client. One module so the two
// clients cannot drift into two spellings of the same call, and so
// the shapes the server returns are written down once.
//
// IT TAKES THE SUPABASE CLIENT AS AN ARGUMENT rather than importing
// one: the web builds its client in storage.js and the phone in
// mobile/lib/supabase.ts, and this file belongs to neither.
//
// NO PLAID CODE IS IMPORTED HERE. These are ordinary authenticated
// POSTs to our own functions; Link itself is opened by the client
// that has a browser to open it in. That is what lets the gate be
// checked before anything is loaded.

/** The slice of supabase-js this module uses. */
export interface FunctionCaller {
  functions: {
    invoke: (name: string, opts?: { body?: unknown }) => Promise<{ data: unknown; error: unknown }>;
  };
  from: (table: string) => {
    select: (cols: string) => {
      maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      eq: (col: string, val: unknown) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
    };
  };
}

export interface Connected {
  institutionName: string | null;
  status: string;
  lastSyncedAt: string | null;
  mask: string | null;
}

export interface PullResult {
  connected: boolean;
  synced: boolean;
  status?: string;
  /** 'written' | 'kept_manual' — whether the pull actually took. */
  applied?: string;
  reason?: string;
  lastSyncedAt: string | null;
}

/**
 * Is this account allowlisted?
 *
 * READ FROM THE TABLE, not from an edge function, because it is the
 * one question that has to be answerable on a cold start before any
 * connected code exists. An empty answer is "no", and a user who is
 * not on the list cannot tell that apart from "the feature is not a
 * thing" — which is the intended experience, not an accident.
 */
export async function isAllowlisted(sb: FunctionCaller): Promise<boolean> {
  try {
    const { data } = await sb.from("plaid_beta").select("user_id").maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/**
 * The current connection, or null.
 *
 * Read straight from `plaid_items` and `plaid_accounts` under RLS —
 * both carry a select policy for the owner's own rows and neither
 * holds a secret. The token is in the Vault and is not reachable from
 * here by any query.
 */
export async function readConnection(sb: {
  from: (t: string) => any; // deno-style loose typing; the real client is supabase-js
}): Promise<Connected | null> {
  const { data: item } = await sb.from("plaid_items")
    .select("institution_name, status, last_synced_at").maybeSingle();
  if (!item) return null;
  const { data: account } = await sb.from("plaid_accounts").select("mask").maybeSingle();
  return {
    institutionName: item.institution_name ?? null,
    status: item.status ?? "ok",
    lastSyncedAt: item.last_synced_at ?? null,
    mask: account?.mask ?? null,
  };
}

/** Mint a Link token. `hosted` asks for the Hosted Link URL (iOS). */
export async function startLink(sb: FunctionCaller, hosted: boolean): Promise<
  { linkToken: string; hostedUrl: string | null } | { error: string }
> {
  const { data, error } = await sb.functions.invoke("plaid-link-token", { body: { hosted } });
  if (error || !data) return { error: "could not start" };
  const d = data as { link_token?: string; hosted_link_url?: string | null };
  if (!d.link_token) return { error: "could not start" };
  return { linkToken: d.link_token, hostedUrl: d.hosted_link_url ?? null };
}

/**
 * Finish a web Link session.
 *
 * ONLY THE WEB CALLS THIS. On iOS the session finishes server-side,
 * through the SESSION_FINISHED webhook, because Hosted Link has no
 * frontend callback — so the phone has nothing to hand back and
 * re-reads its connection instead.
 */
export async function finishLink(sb: FunctionCaller, publicToken: string): Promise<boolean> {
  const { data, error } = await sb.functions.invoke("plaid-exchange", { body: { public_token: publicToken } });
  return !error && !!(data as { connected?: boolean })?.connected;
}

/** Ask the server whether a pull is due, and let it decide. */
export async function pullBalance(sb: FunctionCaller, trigger: "open" | "refresh"): Promise<PullResult | null> {
  const { data, error } = await sb.functions.invoke("plaid-balance", { body: { trigger } });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    connected: !!d.connected,
    synced: !!d.synced,
    status: d.status as string | undefined,
    applied: d.applied as string | undefined,
    reason: d.reason as string | undefined,
    lastSyncedAt: (d.last_synced_at as string | null) ?? null,
  };
}

/** Remove the Item at Plaid and delete our token. Keeps the balances. */
export async function disconnect(sb: FunctionCaller): Promise<boolean> {
  const { data, error } = await sb.functions.invoke("plaid-disconnect", { body: {} });
  return !error && !!(data as { disconnected?: boolean })?.disconnected;
}
