import { useCallback } from "react";
import { Alert, ScrollView, StyleSheet } from "react-native";
import NativeSheet from "./NativeSheet";
import { T } from "../lib/theme";

// A FORM IN THE SYSTEM'S OWN SHEET, with the guard that goes with it.
//
// The transaction form has been a UIKit page sheet since build 9 and
// everything else that takes typed input was still a card drawn at
// the bottom of a transparent modal: a scrim, a rounded top, and no
// swipe at all. Reported 2026-10-17 — "can't be swiped away
// smoothly", which is accurate because there was nothing to swipe.
//
// WHAT A PAGE SHEET BUYS, and why it is not worth hand-building: the
// drag starts anywhere and UIKit coordinates it with the scroll view
// inside; the sheet covers the tab bar because it is a presented view
// controller rather than a view inside a screen that is inset by one;
// and the grabber, radius, rubber band, parent scaling and dimming
// all come from the system. See NativeSheet for the longer version.
//
// AND THE GUARD IS THE SYSTEM'S TOO. `swipeToClose={!dirty}` is
// UIKit's isModalInPresentation inverted: a dirty sheet REFUSES the
// gesture, rubber-bands back and reports the attempt, so the alert
// is never about a sheet that has already slid away and has to be
// put back. That is the part a hand-rolled version gets wrong.
//
// WHICH SHEETS GET THIS, and the test is the same one every time:
// does it hold something somebody typed? A form does and a menu does
// not. The scope sheet, the export list and the horizon picker stay
// where they are — see the note in BottomSheet.

export interface DiscardCopy {
  title: string; body: string; keep: string; discard: string;
}

/**
 * The one door out of a form sheet.
 *
 * Cancel, the hardware back button, UIKit's dimmed area and the
 * downward swipe all arrive here, and anything typed is confirmed
 * before it is thrown away. Four doors is three extra chances to
 * lose what somebody typed, so there is one guard rather than one
 * per door.
 *
 * A CLEAN FORM CLOSES IMMEDIATELY. A confirm over an untouched sheet
 * is the kind of prompt people learn to dismiss without reading,
 * which is how the next one gets dismissed too.
 */
export function useDiscardGuard(dirty: boolean, copy: DiscardCopy, onClose: () => void) {
  return useCallback(() => {
    if (!dirty) { onClose(); return; }
    Alert.alert(copy.title, copy.body, [
      { text: copy.keep, style: "cancel" },
      { text: copy.discard, style: "destructive", onPress: onClose },
    ]);
  }, [dirty, copy, onClose]);
}

/**
 * The sheet itself: UIKit's card, with the form scrolling inside it.
 *
 * NO CARD OF OUR OWN IN HERE. A page sheet IS the card — its corners,
 * its inset from the top, its dimming and its drag are UIKit's — so a
 * rounded, bordered box inside it would be a card in a card. `flex: 1`
 * rather than a height, because a ScrollView in a box with no definite
 * height collapses, which is the oldest trap in React Native.
 */
export default function FormSheet({
  visible = true, onRequestClose, dirty, children,
}: {
  visible?: boolean;
  /** What `useDiscardGuard` returned. */
  onRequestClose: () => void;
  dirty: boolean;
  children: React.ReactNode;
}) {
  return (
    <NativeSheet visible={visible} onClose={onRequestClose} swipeToClose={!dirty}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  inner: { padding: 20, paddingBottom: 40, gap: 6 },
});
