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

export type Prefs = {
  /** The Debt section folded away. Collapsed by default: five loan cards
   *  is most of the Dashboard, and the total is the question most visits
   *  are really asking. */
  debtsExpanded: boolean;
  /** Net position folded away. Someone who does not want to be met by a
   *  big red number should not have to put it away again every launch. */
  heroCollapsed: boolean;
  /** The new-account guide, put away by hand. Per device, like the rest:
   *  it is a statement about this screen on this phone, not a fact about
   *  the budget. It also re-appears on a new device, which is correct —
   *  the steps it names are still the steps that matter. */
  firstRunDismissed: boolean;
  /** The six-step setup flow, finished or left. Per device like the
   *  rest, and here for one reason the account flag cannot cover:
   *  Skip writes `hasSeenOnboarding`, and offline that write cannot
   *  land. Nobody should be stuck in a wizard they already closed
   *  because their train went into a tunnel. */
  setupDismissed: boolean;
  /** The last Sign in with Apple could not file its token with the
   *  server. Kept per device because it describes THIS sign-in on THIS
   *  phone, and cleared the moment one succeeds. See lib/apple.ts for
   *  why the failure is not shown at the moment it happens. */
  appleLinkFailed: boolean;
};
export const DEFAULT_PREFS: Prefs = { heroCollapsed: false, debtsExpanded: false, firstRunDismissed: false, setupDismissed: false, appleLinkFailed: false };

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;   // a preference is never worth failing a render over
  }
}

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
