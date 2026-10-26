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
let syncing = false;
let inFlight: Promise<LoadResult> | null = null;
const listeners = new Set<() => void>();

const announce = () => { for (const l of listeners) l(); };

/** What a load did, for a caller that has state to keep in step. */
export interface LoadResult {
  /** A pull happened AND it wrote a new balance. See load(). */
  wrote: boolean;
}

/** The last known connection. Null means none, or not loaded yet. */
export const connectionNow = (): Connection | null => current;
export const allowlistedNow = (): boolean => allowlisted;
/** Is a balance pull in flight? What the pill says "syncing…" from. */
export const syncingNow = (): boolean => syncing;

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
export function load(settings: { connectedFeatures: boolean }): Promise<LoadResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let wrote = false;
    try {
      allowlisted = await isAllowlisted(supabase as never);
      if (!allowlisted) {
        current = null;
        return { wrote };
      }
      // READ EVEN WITH THE TOGGLE OFF, for an allowlisted account.
      //
      // The toggle used to gate this read, which meant a device that
      // wrongly believed the feature was off would never see the row
      // that proved it wrong — and a HIDDEN LIVE ITEM is the
      // expensive kind on a Trial plan: the user cannot reach
      // Disconnect, so the only way back is a second connection, and
      // Plaid's ten Items are gone forever rather than per-live-item.
      //
      // IT IS NOT "LOADING PLAID" WITH THE FEATURE OFF. This is one
      // select on OUR OWN table under RLS, for an account already on
      // the allowlist; it fetches nothing from Plaid, runs no Plaid
      // code, and for everybody who never connected it returns the
      // same nothing it always did. The caller puts the toggle back
      // when a row turns up — see shouldRestoreToggle.
      const row = await readConnection(supabase as never);
      current = row && {
        institutionName: row.institutionName, status: row.status,
        lastSyncedAt: row.lastSyncedAt, mask: row.mask,
      };
      // NO PULL while the feature is off. Finding the row is about
      // not hiding it; spending a billed call on an account that has
      // switched the feature off is a different thing entirely.
      if (!settings.connectedFeatures) return { wrote };
      if (shouldPullOnOpen(settings, current)) {
        // ANNOUNCED BEFORE AND AFTER, so the pill can say so. A pull
        // takes about five seconds and the strip used to sit on "as
        // of 10/22" throughout, which reads as a tap that did
        // nothing. See PILL_SUFFIX.syncing.
        syncing = true;
        announce();
        let result;
        try {
          result = await pullBalance(supabase as never, "open");
        } finally {
          syncing = false;
        }
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
          // REPORTED, because only the caller can act on it. A pull
          // that wrote has moved a snapshot on the server and the
          // state this app is holding is now the old one — the
          // balance on screen would stay stale until something else
          // happened to refetch. Returning it is how the caller
          // knows to, without reloading after every open.
          wrote = result.synced && result.applied === "written";
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
    return { wrote };
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/** Forget everything — on sign-out, and after a disconnect. */
export function reset(): void {
  current = null;
  allowlisted = false;
  loaded = false;
  // A sign-out in the middle of a pull must not leave the next
  // account's pill saying "syncing…" for ever.
  syncing = false;
  announce();
}

/** Subscribe. Returns the current value and re-renders on change. */
export function useConnection(): {
  connection: Connection | null; allowlisted: boolean; loaded: boolean; syncing: boolean;
} {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return { connection: current, allowlisted, loaded, syncing };
}
