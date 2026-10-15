import { useCallback, useRef } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet } from "react-native";

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
// Having one modal means there is no race to avoid: swapping the CONTENT
// of a presented sheet never presents anything.
//
// `onDismissed` IS THE WAY ACROSS when a screen genuinely has two hosts.
// The Ledger does, since build 9: its transaction form is a real iOS
// page sheet (NativeSheet) and this hosts the scope sheet and the
// horizon picker. Picking "Edit just this date" is therefore exactly
// the original bug again — so the editor is opened from here, once
// UIKit says this one has finished going away. `Modal.onDismiss` is
// iOS-only, which is why it was rejected the first time; this app is
// iOS only and Android is never (settled 2026-10-09), so the reason
// has expired.
//
// NO SWIPE HERE. Build 8 gave this a grabber and a PanResponder; build
// 9 takes both back — see NativeSheet for what replaced them and why.
export default function BottomSheet({
  visible, onClose, onDismissed, testID = "bottom-sheet", children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called once iOS has finished dismissing, not when `visible` flips. */
  onDismissed?: () => void;
  testID?: string;
  children: React.ReactNode;
}) {
  // A STABLE FUNCTION THAT READS THE LATEST HANDLER. `onDismiss`
  // arrives from UIKit a third of a second after `visible` went
  // false, by which time this component has re-rendered — so what
  // the modal is holding must not be a closure over the render that
  // started the dismissal.
  const latest = useRef(onDismissed);
  latest.current = onDismissed;
  const dismissed = useCallback(() => { latest.current?.(); }, []);

  return (
    <Modal
      testID={testID}
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      onDismiss={dismissed}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.scrim}
      >
        {/* Tapping the dimmed area closes. The sheet body stops the press
            so a tap inside it never reaches here. */}
        <Pressable style={styles.tap} onPress={onClose} accessibilityLabel="Close" />
        {children}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  tap: { flex: 1 },
});
