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
  /** Net position folded away. Someone who does not want to be met by a
   *  big red number should not have to put it away again every launch. */
  heroCollapsed: boolean;
};
export const DEFAULT_PREFS: Prefs = { heroCollapsed: false };

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
