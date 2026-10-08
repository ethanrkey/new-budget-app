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
// The obvious fix is to present the editor from the first sheet's
// `onDismiss`. It was not taken: `Modal.onDismiss` is iOS-ONLY, so on
// Android the editor would simply never open, and the two-modal structure
// that caused this would still be there waiting for the next pair of
// sheets. Sequencing avoids the race. Having one modal means there is no
// race to avoid — swapping the CONTENT of a presented sheet never
// presents anything.
export default function BottomSheet({
  visible, onClose, children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
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
