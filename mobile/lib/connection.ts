import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Connection } from "../../src/shared/connect.ts";
import { shouldPullOnOpen } from "../../src/shared/connect.ts";
import { isAllowlisted, pullBalance, readConnection } from "../../src/shared/plaidApi.ts";

// ONE ANSWER TO "IS THERE A BANK", shared by everything that asks.
//
// The anchor strip is on all four tabs, so a hook that fetched per
// component would ask the server four times for the same row on
// every tab change. This is a module-level store with subscribers:
// one read, one pull, four readers.
//
// IT IS INERT UNTIL SOMETHING TURNS IT ON. `load` is never called
// with connected features off, so an account that has not opted in
// makes no request, holds no state, and runs none of this — which is
// what "no Plaid code is loaded" has to mean in practice.

let current: Connection | null = null;
let allowlisted = false;
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

const announce = () => { for (const l of listeners) l(); };

/** The last known connection. Null means none, or not loaded yet. */
export const connectionNow = (): Connection | null => current;
export const allowlistedNow = (): boolean => allowlisted;

export function setConnection(next: Connection | null): void {
  current = next;
  announce();
}

/**
 * Read the connection, and pull a balance if one is due.
 *
 * THE 12-HOUR WINDOW IS THE SERVER'S, not ours. This asks on every
 * open and lets `plaid-balance` decide — the clock is per account so
 * that one pull serves every device, and this codebase does not
 * trust device clocks (see syncGuard.ts). A client that skipped the
 * call because its own clock said "too soon" is the one way to end
 * up with a balance nobody ever refreshed.
 */
export function load(settings: { connectedFeatures: boolean }): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      allowlisted = await isAllowlisted(supabase as never);
      if (!allowlisted || !settings.connectedFeatures) {
        current = null;
        return;
      }
      const row = await readConnection(supabase as never);
      current = row && {
        institutionName: row.institutionName, status: row.status, lastSyncedAt: row.lastSyncedAt,
      };
      if (shouldPullOnOpen(settings, current)) {
        const result = await pullBalance(supabase as never, "open");
        // A pull that actually wrote changes the snapshot the state
        // provider is holding, so the number on screen would be the
        // old one until something else refetched. Re-reading the
        // connection is not enough; the caller re-syncs state.
        if (result) {
          current = current && {
            ...current,
            status: result.status ?? current.status,
            lastSyncedAt: result.lastSyncedAt ?? current.lastSyncedAt,
          };
        }
      }
    } catch {
      // A connection we could not read is one we do not draw. It is
      // never an error on screen: manual entry is the product and it
      // is unaffected.
      current = null;
    } finally {
      loaded = true;
      announce();
    }
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/** Forget everything — on sign-out, and after a disconnect. */
export function reset(): void {
  current = null;
  allowlisted = false;
  loaded = false;
  announce();
}

/** Subscribe. Returns the current value and re-renders on change. */
export function useConnection(): { connection: Connection | null; allowlisted: boolean; loaded: boolean } {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return { connection: current, allowlisted, loaded };
}
