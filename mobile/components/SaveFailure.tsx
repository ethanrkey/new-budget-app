import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";

// A write that does not land SAYS SO. Same reasoning as the web's
// out-of-date-tab notice: the worst shape a save failure can take is
// silence, because the user keeps working and keeps losing.
//
// A modal rather than a toast, deliberately — a toast is dismissed by
// time, and the thing being reported is that your change is gone unless
// you act. This asks for an acknowledgment.
export default function SaveFailure({
  reason, onRetry, onDismiss, onReload,
}: {
  reason: "conflict" | "offline" | "error" | null;
  onRetry: () => void;
  onDismiss: () => void;
  onReload: () => void;
}) {
  if (!reason) return null;
  const conflict = reason === "conflict";

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onDismiss}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {conflict ? "Someone else changed this" : "Connection lost"}
          </Text>
          <Text style={styles.body}>
            {conflict
              ? "Your data was updated somewhere else while this screen was open, so this change wasn't saved. Reload to pick up the newer version — what you just entered will be lost."
              : "Your changes couldn't be saved. Reconnect and try again."}
          </Text>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.ghost]} onPress={onDismiss}>
              <Text style={styles.ghostText}>Dismiss</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.primary]} onPress={conflict ? onReload : onRetry}>
              <Text style={styles.primaryText}>{conflict ? "Reload" : "Try again"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, backgroundColor: T.surface, borderRadius: 18, borderWidth: 1, borderColor: T.border, padding: 20, gap: 10 },
  title: { color: T.text, fontSize: 17, fontWeight: "700" },
  body: { color: T.dim, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: 10, marginTop: 8 },
  btn: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: T.border },
  ghostText: { color: T.dim, fontSize: 15 },
  primary: { backgroundColor: T.brass },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "700" },
});
