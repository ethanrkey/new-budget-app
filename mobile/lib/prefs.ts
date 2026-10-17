// Per-device display preferences, the phone's half of src/devicePrefs.js.
//
// Same rule as the web: how the UI is arranged on THIS device is not
// account data. It never syncs, never conflicts between devices and never
// reaches the state blob.
//
// LOADED BEFORE THE FIRST RENDER, not during it. The web reads
// localStorage synchronously in a lazy initializer precisely so a
// collapsed panel never flashes open; AsyncStorage cannot do that, so
// StateProvider waits for these alongside the state it is already waiting
// for. The cost is nothing — it resolves long before the network does.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "budget-app-prefs-v1";

// TWO OF THESE ARE LISTS OF USER IDS, NOT BOOLEANS — 2026-10-17.
//
// They were booleans, and that was a bug a tester hit on his own phone:
// two brand-new accounts (one after the other, same device) were met by
// neither setup nor the tour, because the account BEFORE them had
// finished setup and written `setupDismissed: true` here. A device flag
// answering an account question says "this phone has done setup", which
// is not a thing a phone can do.
//
// So the rule, and it is the rule for anything added here later: WHO
// SEES WHICH FLOW IS AN ACCOUNT QUESTION — `hasSeenOnboarding`,
// `hasSeenTour`, `isNewAccount`, all of them synced settings. The only
// reason a copy survives on the device is the offline case named on
// `setupDismissedBy` below, and a per-device answer to a per-account
// question has to be keyed by the account.
//
// THE OLD BOOLEANS ARE DROPPED RATHER THAN MIGRATED. Migrating
// `setupDismissed: true` would have to mean "every account on this
// phone", which is the bug. Dropping it costs at most one person — one
// who skipped setup while offline and has not been online since — being
// asked once more; every other case is already answered by the account
// flag, which `shouldRunSetup` checks first.
export type Prefs = {
  /** The Debt section folded away. Collapsed by default: five loan cards
   *  is most of the Dashboard, and the total is the question most visits
   *  are really asking. */
  debtsExpanded: boolean;
  /** Net position folded away. Someone who does not want to be met by a
   *  big red number should not have to put it away again every launch. */
  heroCollapsed: boolean;
  /** Who has put the new-account guide away on this device — USER IDS,
   *  not a boolean. See the note above the type. */
  firstRunDismissedBy: string[];
  /** Who has closed the six-step setup flow on this device — USER IDS.
   *  Still per device, because the reason it exists is the offline case:
   *  Skip writes `hasSeenOnboarding`, and offline that write cannot land,
   *  so nobody should be stuck in a wizard they already closed because
   *  their train went into a tunnel. But it is per device PER ACCOUNT. */
  setupDismissedBy: string[];
  /** The last Sign in with Apple could not file its token with the
   *  server. Kept per device because it describes THIS sign-in on THIS
   *  phone, and cleared the moment one succeeds. See lib/apple.ts for
   *  why the failure is not shown at the moment it happens. */
  appleLinkFailed: boolean;
};
export const DEFAULT_PREFS: Prefs = { heroCollapsed: false, debtsExpanded: false, firstRunDismissedBy: [], setupDismissedBy: [], appleLinkFailed: false };

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      // A file written before 2026-10-17 has booleans under the old
      // names and nothing under these, and a hand-edited one could
      // have anything. Either way what comes out is a list.
      firstRunDismissedBy: idList(parsed.firstRunDismissedBy),
      setupDismissedBy: idList(parsed.setupDismissedBy),
    };
  } catch {
    return DEFAULT_PREFS;   // a preference is never worth failing a render over
  }
}

const idList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// The three list helpers moved to lib/dismissal.ts on 2026-10-17, so
// the plain-node harness and the mutation audit can reach them without
// a React Native runtime. This file still owns the FILE.
export { dismissedBy, withDismissalBy, withoutDismissalBy } from "./dismissal";

export async function savePrefs(prefs: Prefs): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

/**
 * Change one preference from OUTSIDE React.
 *
 * `setPref` needs the provider, and the one caller here runs before
 * there is one: Sign in with Apple finishes on the sign-in screen,
 * which is rendered instead of StateProvider, not inside it. Reads
 * the current file rather than assuming, so this cannot clobber a
 * preference it does not know about.
 */
export async function patchPrefs(patch: Partial<Prefs>): Promise<void> {
  await savePrefs({ ...(await loadPrefs()), ...patch });
}
