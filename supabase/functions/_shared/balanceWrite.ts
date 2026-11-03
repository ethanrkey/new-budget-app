// THE ONE WAY A BANK BALANCE BECOMES A SNAPSHOT, shared by
// plaid-balance (the pull, and "Use bank balance") and plaid-exchange
// (the balance read while connecting, 2026-11-03).
import { localDateIn } from "./plaid.ts";

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
export async function writeBalance(admin: any, userId: string, account: { plaid_account_id: string },
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

