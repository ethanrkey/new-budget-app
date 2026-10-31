import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Connection } from "../../src/shared/connect.ts";
import { shouldPullOnOpen, syncMoved } from "../../src/shared/connect.ts";
import { forgetPullDeadline, isAllowlisted, pullBalance, pullIsDue, readConnection } from "../../src/shared/plaidApi.ts";

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
  /**
   * The balance on the server may have moved since the state was
   * read — re-read it. True when a pull this device made wrote, AND
   * when `last_synced_at` moved by any other route: another device's
   * pull, or this device's own whose reply never arrived. See
   * syncMoved.
   */
  reload: boolean;
}

/**
 * Why load() was called, because the four do not ask the same thing.
 *
 *   cold        a launch. Always asks — a new process has no deadline
 *               — and the pill says "syncing…" until it knows.
 *   foreground  back from the background. Asks NOTHING, not even our
 *               own table, until the server's window has passed. This
 *               was a function call and a "syncing…" flash on every
 *               single return to the app (2026-10-30).
 *   swipe       pull-to-refresh. Always asks, because somebody asked;
 *               says "syncing…" only if a pull is actually due.
 *   connect     after Link. Always asks.
 */
export type LoadReason = "cold" | "foreground" | "swipe" | "connect";

/** The last known connection. Null means none, or not loaded yet. */
export const connectionNow = (): Connection | null => current;
export const allowlistedNow = (): boolean => allowlisted;
/** Is a balance pull in flight? What the pill says "syncing…" from. */
export const syncingNow = (): boolean => syncing;

export function setConnection(next: Connection | null): void {
  current = next;
  announce();
}

const asConnection = (row: Awaited<ReturnType<typeof readConnection>>): Connection | null => row && {
  institutionName: row.institutionName, status: row.status,
  lastSyncedAt: row.lastSyncedAt, mask: row.mask,
};

/**
 * Read the connection, and pull a balance if one is due.
 *
 * THE 12-HOUR WINDOW IS STILL THE SERVER'S. What changed on
 * 2026-10-30 is that the server now says how long is left, and a
 * foreground return waits that long before asking again — measured
 * on two device clocks, either of which can end the wait (see
 * pullDue). A cold start always asks, so no clock fault can do worse
 * than delay a pull to the next launch.
 */
export function load(settings: { connectedFeatures: boolean }, reason: LoadReason = "cold"): Promise<LoadResult> {
  if (inFlight) return inFlight;
  // NOTHING DUE, NOTHING ASKED. Only once something has been loaded:
  // a "foreground" before the first load is a cold start in disguise.
  if (reason === "foreground" && loaded && current && !pullIsDue()) {
    return Promise.resolve({ reload: false });
  }
  const seenBefore = loaded ? current?.lastSyncedAt ?? null : undefined;
  inFlight = (async () => {
    let reload = false;
    try {
      allowlisted = await isAllowlisted(supabase as never);
      if (!allowlisted) {
        current = null;
        return { reload };
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
      current = asConnection(await readConnection(supabase as never));
      const readSynced = current?.lastSyncedAt ?? null;
      // A STAMP THAT MOVED WHILE WE WERE AWAY is somebody else's pull,
      // and the balance it wrote is not in the state we hold.
      if (seenBefore !== undefined && syncMoved(seenBefore, readSynced)) reload = true;
      // NO PULL while the feature is off. Finding the row is about
      // not hiding it; spending a billed call on an account that has
      // switched the feature off is a different thing entirely.
      if (!settings.connectedFeatures) return { reload };
      if (shouldPullOnOpen(settings, current)) {
        // "syncing…" WHEN A PULL IS REALLY LIKELY, and on a cold
        // start, which has no way to know and promised not to say
        // "as of" in the meantime. A swipe over a fresh balance is a
        // function call answering no; it says nothing.
        syncing = reason !== "swipe" || pullIsDue();
        if (syncing) announce();
        let result;
        try {
          result = await pullBalance(supabase as never, "open");
        } finally {
          syncing = false;
        }
        if (result) {
          current = current && {
            ...current,
            status: result.status ?? current.status,
            lastSyncedAt: result.lastSyncedAt ?? current.lastSyncedAt,
          };
          if (result.synced && result.applied === "written") reload = true;
          // Fresh, but fresher than the row we read a moment ago:
          // another device pulled in between.
          if (syncMoved(readSynced, result.lastSyncedAt)) reload = true;
        } else {
          // THE REPLY WAS LOST, NOT NECESSARILY THE PULL. The server
          // may have written and then failed to tell us; one select
          // on our own table says whether it did.
          const again = asConnection(await readConnection(supabase as never));
          if (again) current = again;
          if (syncMoved(readSynced, again?.lastSyncedAt)) reload = true;
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
    return { reload };
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
  forgetPullDeadline();
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
