import { useEffect, useMemo, useRef } from "react";
import {
  Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, StyleSheet, View,
} from "react-native";

// ONE MODAL PER SCREEN, and everything that looks like a sheet is content
// inside it.
//
// This exists because of a bug, and the shape of the bug is the reason it
// is a component rather than a convention. Picking "Edit just this date"
// from the scope sheet did nothing: the scope sheet's Modal was being
// unmounted and the editor's Modal mounted in the same React commit, and
// iOS cannot present a modal while another is still dismissing, so the
// second presentation was swallowed. Delete kept working, because an
// Alert is not a Modal — which is exactly the tell.
//
// The obvious fix is to present the editor from the first sheet's
// `onDismiss`. It was not taken: `Modal.onDismiss` is iOS-ONLY, so on
// Android the editor would simply never open, and the two-modal structure
// that caused this would still be there waiting for the next pair of
// sheets. Sequencing avoids the race. Having one modal means there is no
// race to avoid — swapping the CONTENT of a presented sheet never
// presents anything.
//
// SWIPE DOWN TO DISMISS, added 2026-10-15 because the transaction form
// takes most of the screen and Cancel is at the bottom of it. The
// gesture lives on the GRABBER rather than on the whole sheet, which
// is both what iOS does and the only version that cannot fight the
// scroll view inside: a responder on the body would have to know
// whether the content is scrolled to the top, and the body belongs to
// whoever is being hosted.
//
// A flick is the same door as Cancel, not a quieter one — it calls
// `onClose`, and whatever guard `onClose` carries (the Ledger's
// "Discard changes?") applies to it exactly as it does to the button.
// If that guard refuses, the sheet is already springing back.

/** Past this much drag, or this much flick, it is a dismissal. */
const DISMISS_PX = 90;
const DISMISS_VELOCITY = 0.7;

export default function BottomSheet({
  visible, onClose, children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const y = useRef(new Animated.Value(0)).current;
  // The handler is built once; `onClose` is read through a ref so a
  // fresh one is used without rebuilding the responder mid-gesture.
  const close = useRef(onClose);
  close.current = onClose;

  // A sheet that was dragged and then refused ("Keep editing") must
  // not reopen already half off the bottom.
  useEffect(() => { if (visible) y.setValue(0); }, [visible, y]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 2,
    // Downward only. Dragging a sheet UP past its own top is the one
    // thing a bottom sheet must not do.
    onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_e, g) => {
      const go = g.dy > DISMISS_PX || g.vy > DISMISS_VELOCITY;
      // Spring back EITHER WAY. On a real dismissal the modal slides
      // out over the top of it so the spring is never seen, and on a
      // refused one the sheet is already back where it belongs.
      Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      if (go) close.current();
    },
  }), [y]);

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.scrim}
      >
        {/* Tapping the dimmed area closes. The sheet body stops the press
            so a tap inside it never reaches here. */}
        <Pressable style={styles.tap} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View style={{ transform: [{ translateY: y }] }}>
          {/* The grabber. Its strip is 24pt of touchable area for a
              4pt pill, because the pill is a sign rather than a
              target. */}
          <View {...pan.panHandlers} style={styles.grab} testID="sheet-grabber">
            <View style={styles.grabber} />
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  tap: { flex: 1 },
  grab: { height: 24, alignItems: "center", justifyContent: "center" },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.35)" },
});
