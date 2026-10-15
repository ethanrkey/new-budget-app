import { KeyboardAvoidingView, Modal, Platform, StyleSheet } from "react-native";
import { T } from "../lib/theme";

// THE SYSTEM'S OWN SHEET, for the one surface that is big enough to
// deserve it: the transaction form.
//
// WHAT THIS REPLACES. Build 8 gave BottomSheet a grabber and a
// PanResponder so the form could be flicked away. On a device it was
// worse than nothing: the drag only started from the grab bar, because
// a responder on the body would fight the ScrollView inside it, and
// the extra wrapper the gesture needed left a gap under the sheet with
// the tab bar showing through.
//
// `presentationStyle="pageSheet"` is UIKit's sheet, and it does for
// free every part of that which was being hand-built:
//
//   - the drag starts ANYWHERE in the sheet, and UIKit coordinates it
//     with the scroll view — pulling down at the top of the content
//     moves the sheet, pulling down anywhere else scrolls;
//   - the sheet is a presented view controller, so it covers the tab
//     bar rather than sitting inside the screen that is inset by it;
//   - the grabber, the corner radius, the rubber band, the parent
//     scaling back behind it and the dimming all come from the system
//     and track whatever Apple changes next.
//
// AND THE GUARD IS THE SYSTEM'S TOO. `allowSwipeDismissal` is RN's
// name for `UIViewController.isModalInPresentation` inverted
// (RCTModalHostViewComponentView.mm sets
// `_modalInPresentation = !allowSwipeDismissal`). Pass `false` and
// UIKit REFUSES the gesture itself: the sheet rubber-bands back and
// `presentationControllerDidAttemptToDismiss` fires, which RN
// surfaces as `onRequestClose`. So a dirty form cannot be swiped
// away by accident — it asks — and the asking happens without the
// sheet having moved anywhere it has to be put back from, which is
// the part a hand-rolled version gets wrong.
//
// Pass `true` and the gesture dismisses for real;
// `presentationControllerDidDismiss` fires the same `onRequestClose`,
// so the host hears about it either way and there is one door.
//
// NOT TRANSPARENT, and RN warns if you try: a page sheet IS the card.
// There is no scrim of ours to tap, because UIKit's own dimming
// handles that tap and routes it through the same two delegate
// methods.
export default function NativeSheet({
  visible, onClose, swipeToClose, children,
}: {
  visible: boolean;
  /** The one door: Cancel, the swipe, the dim area and hardware back. */
  onClose: () => void;
  /**
   * May the gesture dismiss it outright?
   *
   * False while the form holds unsaved work. UIKit then refuses the
   * swipe and reports the attempt, and `onClose` does the asking.
   */
  swipeToClose: boolean;
  children: React.ReactNode;
}) {
  return (
    <Modal
      testID="native-sheet"
      visible={visible}
      presentationStyle="pageSheet"
      animationType="slide"
      allowSwipeDismissal={swipeToClose}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.page}
      >
        {children}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // The sheet's own surface. A page sheet draws no background of its
  // own, so without this the card is whatever UIKit's default is —
  // white, in a dark-only app.
  page: { flex: 1, backgroundColor: T.surface },
});
