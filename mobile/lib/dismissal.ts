// WHO, ON THIS PHONE, HAS PUT A ONE-TIME FLOW AWAY.
//
// Three lines of list arithmetic, in a file of their own, for the same
// reason lib/chunks.ts and lib/readout.ts are: they can then be run by
// the plain-node harness in milliseconds and broken on purpose by the
// mutation audit. lib/prefs.ts cannot — it imports AsyncStorage, which
// needs a React Native runtime to load at all.
//
// THE BUG THESE EXIST TO END, 2026-10-17. Setup and the new-account
// guide were each gated on a bare device boolean, so the first account
// to finish setup on a phone turned both off for every account that
// signed in afterwards. Two brand-new test accounts on the owner's own
// phone were met by neither the flow nor the tour that follows it.
//
// The rule now, and the rule for anything added later: WHO SEES WHICH
// FLOW IS AN ACCOUNT QUESTION — hasSeenOnboarding, hasSeenTour,
// isNewAccount, all synced settings. A device copy exists only for the
// offline case (see setupDismissedBy in lib/prefs.ts), and a
// per-device answer to a per-account question is keyed by the account.

/**
 * Twelve accounts, newest last.
 *
 * Capped because this is the one preference that GROWS: a shared phone,
 * or a tester cycling through +kbtest addresses, would otherwise write
 * an unbounded array to disk forever. Twelve is far more accounts than
 * a phone has, and the oldest falling off only means that account is
 * asked once more — the same cost as the migration in lib/prefs.ts.
 */
export const DISMISSAL_CAP = 12;

/** Has THIS account put this flow away on this device? */
export function dismissedBy(list: readonly string[], userId: string): boolean {
  return list.includes(userId);
}

/** The list with `userId` added — deduplicated, capped, newest last. */
export function withDismissalBy(list: readonly string[], userId: string): string[] {
  return [...list.filter((id) => id !== userId), userId].slice(-DISMISSAL_CAP);
}

/** The list with `userId` removed — what Wipe data does, for one account. */
export function withoutDismissalBy(list: readonly string[], userId: string): string[] {
  return list.filter((id) => id !== userId);
}
