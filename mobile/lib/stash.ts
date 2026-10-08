// The recovery stash: nothing in memory is replaced without a copy first.
//
// This ships WITH transaction editing, not after it. Until now the phone
// could write exactly two things, each one small action with a visible
// rollback, so there was nothing a crash could lose that you would not
// immediately notice. Editing the forecast changes that, and shipping bulk
// editing onto a client with no stash is shipping the gap rather than
// approaching it.
//
// WHAT IT CANNOT DO, stated up front. The web stashes to localStorage
// SYNCHRONOUSLY before anything replaces in-memory state, and the synchrony
// is the guarantee: the copy exists before the thing it copies is gone.
// AsyncStorage has no synchronous write, so this awaits the stash before
// the optimistic apply and accepts that a hard kill inside that window
// loses the write. That is the right side to fail on — "the stash is
// missing" is recoverable by retyping, "the stash is wrong" is silent
// corruption.
//
// AND IT IS NEVER REPLAYED. On relaunch an unsaved stash is reported and
// discarded, never re-applied. Re-applying means deciding whether the
// server moved underneath it, which is a merge; this project has ruled out
// merges on the phone, and the branch would run perhaps once a year per
// user — rare enough that nothing real would ever exercise it, which is
// exactly how this week's four worst bugs survived. The cost of not
// replaying is retyping one transaction almost never. The cost of
// replaying wrongly is a silent bad write.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BudgetState } from "../../src/engine/types.ts";

const KEY = "budget-app-stash-v1";

export type Stash = {
  /** Which account it belongs to — a stash must never cross a sign-in. */
  userId: string;
  /** ISO timestamp of the attempt. */
  at: string;
  /** What the user was doing, in their words: "Rent on Oct 12". Shown on
   *  relaunch, so it has to mean something without the state blob. */
  label: string;
  /** The state that was being saved. Kept so the loss is inspectable in a
   *  bug report, never to be written back. */
  state: BudgetState;
};

/** Write the copy. Awaited BEFORE the optimistic apply — see the note above
 *  about why that ordering is the whole point. Never throws: a stash that
 *  cannot be written must not block the write it was protecting. */
export async function writeStash(userId: string, label: string, state: BudgetState): Promise<void> {
  try {
    const entry: Stash = { userId, at: new Date().toISOString(), label, state };
    await AsyncStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // Storage full or unavailable. Losing the safety copy is bad; refusing
    // to let someone edit their budget because of it is worse.
  }
}

/** Confirmed saved — the copy has done its job. */
export async function clearStash(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch { /* nothing to do */ }
}

/**
 * Any stash left over from a previous launch, for this user. A stash for a
 * different account is dropped rather than shown: it is not this person's
 * data, and the label alone could leak a name from another sign-in.
 */
export async function readStash(userId: string): Promise<Stash | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<Stash>;
    if (!entry || typeof entry.label !== "string" || typeof entry.at !== "string") return null;
    if (entry.userId !== userId) { await clearStash(); return null; }
    return entry as Stash;
  } catch {
    // A corrupt entry is treated as no entry, and cleared so it cannot be
    // reported every launch for ever.
    await clearStash();
    return null;
  }
}

/** "2 hours ago", for the relaunch notice. Deliberately coarse: the exact
 *  second is noise, and the only question being answered is "was this the
 *  thing I was just doing, or something I have forgotten about". */
export function sinceLabel(iso: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
