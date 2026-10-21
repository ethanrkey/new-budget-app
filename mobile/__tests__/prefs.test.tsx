import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_PREFS, loadPrefs } from "../lib/prefs";

// What comes back out of a prefs file written by an older build, or
// edited by hand, or half-written by a crash.
//
// WHY THIS FILE EXISTS. `firstRunDismissedBy` and `setupDismissedBy`
// were BOOLEANS until 2026-10-17, and the thing that made them lists
// was a tester meeting neither setup nor the tour on two brand-new
// accounts, because the account before them had written
// `setupDismissed: true` on that phone. Every install from before
// that day still has the booleans on disk.
//
// Nothing tested the conversion. The mutation audit on 2026-10-21
// took `idList` down to `(v as string[]) ?? []` — which hands back
// `true` for a list — and all 1,916 checks passed. Downstream that
// is `dismissedBy(true, userId)` and `[...true, id]`: a crash on
// launch, on exactly the devices that have been here longest.

const KEY = "budget-app-prefs-v1";

beforeEach(async () => { await AsyncStorage.clear(); });

test("a prefs file from before the lists existed loads as lists", async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({
    // The old shape, verbatim: booleans under the old names AND
    // under the new ones, which is what a hand-edit looks like.
    setupDismissed: true,
    firstRunDismissedBy: true,
    setupDismissedBy: false,
    heroCollapsed: true,
  }));
  const prefs = await loadPrefs();
  expect(Array.isArray(prefs.firstRunDismissedBy)).toBe(true);
  expect(prefs.firstRunDismissedBy).toEqual([]);
  expect(Array.isArray(prefs.setupDismissedBy)).toBe(true);
  expect(prefs.setupDismissedBy).toEqual([]);
  // AND THE REST OF THE FILE SURVIVES. Dropping the old booleans is
  // deliberate; dropping someone's collapsed panel with them is not.
  expect(prefs.heroCollapsed).toBe(true);
});

test("a list with junk in it keeps only the ids", async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({
    firstRunDismissedBy: ["user-1", null, 7, "user-2", { id: "user-3" }],
  }));
  expect((await loadPrefs()).firstRunDismissedBy).toEqual(["user-1", "user-2"]);
});

test("a real list is left alone", async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ setupDismissedBy: ["user-1"] }));
  expect((await loadPrefs()).setupDismissedBy).toEqual(["user-1"]);
});

test("an unreadable file is the defaults, not a failed render", async () => {
  await AsyncStorage.setItem(KEY, "{not json");
  expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
});
