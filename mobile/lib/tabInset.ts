import { useSafeAreaInsets } from "react-native-safe-area-context";

// How much empty space a tab's scroll content needs under it.
//
// THE BAR FLOATS OVER THE CONTENT. `NativeTabs` is a real
// `UITabBarController`, and on iOS 26 its bar is Liquid Glass — it
// recolors itself against whatever scrolls underneath, which only
// works because the content genuinely passes underneath. That is the
// right behavior while scrolling and the wrong one at rest: at the
// bottom of the list, the last row stops under the bar and cannot be
// scrolled out from under it. Reported on the Ledger's calendar,
// where the thing stuck under the bar was the whole bottom edge of
// the selected-day card.
//
// WHY THIS IS A HOOK AND NOT A NUMBER. `useSafeAreaInsets()` called
// from inside a tab screen already answers it. expo-router wraps each
// tab's content in its OWN `SafeAreaProvider`
// (`native-tabs/NativeTabsView.ios`), and that provider reports the
// insets of its own view rather than the window's — so under a tab
// bar controller, `bottom` is the bar plus the home indicator, not
// just the home indicator. A hardcoded 83 would be the same number on
// one phone and wrong on every other, and wrong again the next time
// Apple changes the bar.
//
// CHROME IS DIFFERENT, deliberately. `components/Chrome.tsx` sits
// OUTSIDE the tabs host, so the same hook there reads the window and
// its `insets.top` is the notch — which is what the AnchorStrip
// wants.
//
// THE ONE MECHANISM. react-native-screens also tries to solve this:
// `RNSScrollViewHelper` finds the first scroll view in the first
// descendant chain of a tab screen and flips its
// `contentInsetAdjustmentBehavior` from `never` to `automatic`. It
// is off here — `disableAutomaticContentInsets` on every trigger in
// `app/(tabs)/_layout.tsx` — because two mechanisms for one inset can
// only ever agree by luck: with both on, a screen it finds gets the
// space twice and a screen it misses gets it once. Off, every tab
// screen gets it exactly once, from here, and a test can read the
// number.

/** Breathing room between the last row and the top of the bar. */
export const TAB_CONTENT_GAP = 16;

/**
 * The bottom padding a tab's scroll content needs: the floating tab
 * bar, the home indicator, and a gap so the last row is not touching
 * the glass.
 *
 * Only correct INSIDE a tab screen — see the note above about Chrome.
 */
export function useTabScrollInset(gap: number = TAB_CONTENT_GAP): number {
  return useSafeAreaInsets().bottom + gap;
}
