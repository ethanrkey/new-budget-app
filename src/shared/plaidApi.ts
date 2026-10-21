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

/**
 * IS ONE OF OUR OWN SERVER-SIDE WRITES OUTSTANDING?
 *
 * A pull, a connect and "Use bank balance" all change the user's
 * rows from an edge function. For the moment between asking and
 * re-reading, the row on the server has moved and this tab has no
 * record of having moved it — so the web's "did anything change
 * while I was away?" check found the new version and announced the
 * user's own tap as "your data had changed on another device."
 *
 * IT LIVES HERE, WITH THE CALLS, so a caller cannot forget: every
 * function below that writes claims it for the length of the
 * request. A client extends the claim over its own reload, which is
 * the part this module cannot see — one counter, two holders, rather
 * than two predicates that have to agree.
 *
 * A COUNT, not a flag: two overlapping pulls would otherwise have
 * the first one's finish release the second one's claim.
 */
let writesInFlight = 0;
export const plaidWriteInFlight = (): boolean => writesInFlight > 0;
export async function duringPlaidWrite<T>(fn: () => Promise<T>): Promise<T> {
  writesInFlight += 1;
  try { return await fn(); } finally { writesInFlight -= 1; }
}

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
/**
 * THE FUNCTIONS ANSWER 200 WITH `{ ok: false, code }` RATHER THAN A
 * 5xx when a request was understood and did not work.
 *
 * supabase-js turns any non-2xx into a thrown `FunctionsHttpError`
 * whose body the caller has to go digging for, so the useful part —
 * Plaid's own error code — arrives as "something exploded". The
 * first sandbox connection failed with `NOT_FOUND` and all the page
 * could say was 502. `error` here is now a transport failure and
 * nothing else; everything the server meant to say is in `code`.
 */
export async function startLink(sb: FunctionCaller, hosted: boolean, update = false): Promise<
  { linkToken: string; hostedUrl: string | null; update: boolean } | { error: string }
> {
  const { data, error } = await sb.functions.invoke("plaid-link-token", { body: { hosted, update } });
  if (error || !data) return { error: "unreachable" };
  const d = data as { ok?: boolean; code?: string; link_token?: string; hosted_link_url?: string | null };
  if (d.ok === false || !d.link_token) return { error: d.code ?? "unknown" };
  return { linkToken: d.link_token, hostedUrl: d.hosted_link_url ?? null, update };
}

/**
 * Finish a web Link session.
 *
 * ONLY THE WEB CALLS THIS. On iOS the session finishes server-side,
 * through the SESSION_FINISHED webhook, because Hosted Link has no
 * frontend callback — so the phone has nothing to hand back and
 * re-reads its connection instead.
 */
export async function finishLink(sb: FunctionCaller, publicToken: string): Promise<
  { ok: true } | { ok: false; code: string }
> {
  return duringPlaidWrite(async () => {
    const { data, error } = await sb.functions.invoke("plaid-exchange", { body: { public_token: publicToken } });
    if (error || !data) return { ok: false as const, code: "unreachable" };
    const d = data as { ok?: boolean; code?: string; connected?: boolean };
    return d.connected ? { ok: true as const } : { ok: false as const, code: d.code ?? "unknown" };
  });
}

/**
 * The device's IANA timezone, for dating the snapshot.
 *
 * SENT ON EVERY PULL, including pull-on-open, because the server has
 * no other way to know what day it is where the user is — a balance
 * pulled at 8:46 PM Eastern belongs to that evening and not to the
 * UTC tomorrow that has already begun. A ZONE and not a date: the
 * snapshot date is the forecast's anchor, and a client that sent a
 * date could send one far enough out to move the whole forecast.
 */
export function deviceTimeZone(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
  catch { return null; }
}

/**
 * Ask the server whether a pull is due, and let it decide.
 *
 * `reconnect` is the one trigger that gets past a `login_required`
 * item, because a successful pull is the only honest proof that
 * update-mode Link repaired anything. See plaid-balance.
 */
export async function pullBalance(
  sb: FunctionCaller,
  trigger: "open" | "refresh" | "adopt" | "reconnect",
): Promise<PullResult | null> {
  return duringPlaidWrite(async () => {
    const { data, error } = await sb.functions.invoke("plaid-balance", { body: { trigger, timeZone: deviceTimeZone() } });
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
  });
}

/** Remove the Item at Plaid and delete our token. Keeps the balances. */
export async function disconnect(sb: FunctionCaller): Promise<boolean> {
  return duringPlaidWrite(async () => {
    const { data, error } = await sb.functions.invoke("plaid-disconnect", { body: {} });
    return !error && !!(data as { disconnected?: boolean })?.disconnected;
  });
}
