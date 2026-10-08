import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";
import { sinceLabel, type Stash } from "../lib/stash";

// A change that was in flight when the app died. Reported, then discarded.
//
// There is one button on purpose. The obvious second one — "Restore" —
// would mean writing a saved snapshot back over whatever the server holds
// now, and deciding whether that is safe is a merge. This client has no
// merge, by decision, and a branch that runs when an app is killed inside
// a few hundred milliseconds would never be exercised by anything real:
// the four worst bugs of the week all survived exactly that way. Retyping
// one transaction almost never is the cheaper mistake than writing the
// wrong one silently.
//
// So the job here is to make the loss VISIBLE and specific. "Something
// didn't save" is not actionable; "Rent on Oct 12, 2 hours ago" is.
export default function UnsavedNotice({ stash, onDiscard }: { stash: Stash | null; onDiscard: () => void }) {
  if (!stash) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onDiscard}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>An edit wasn&apos;t saved</Text>
          <Text style={styles.what}>{stash.label}</Text>
          <Text style={styles.body}>
            The app closed {sinceLabel(stash.at)} before this change reached the server, so it
            isn&apos;t in your budget. Nothing else was affected. Enter it again if you still want it.
          </Text>
          <Pressable style={styles.btn} onPress={onDiscard} accessibilityRole="button">
            <Text style={styles.btnText}>OK</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, backgroundColor: T.surface, borderRadius: 18, borderWidth: 1, borderColor: T.border, padding: 20, gap: 8 },
  title: { color: T.text, fontSize: 17, fontWeight: "700" },
  what: { color: T.brass, fontSize: 15, fontWeight: "600" },
  body: { color: T.dim, fontSize: 14, lineHeight: 20 },
  btn: { marginTop: 8, minHeight: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: T.brass },
  btnText: { color: "#111827", fontSize: 15, fontWeight: "700" },
});
