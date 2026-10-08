import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { T } from "../lib/theme";

// ONE date picker, with a way out of it.
//
// There were three copies of this and one of them — the Ledger's horizon
// chip — could not be closed at all. The expression was
// `setPicking(Platform.OS === "ios")`, which on iOS is `setPicking(true)`:
// choosing a date RE-OPENED it, and with `display="inline"` the picker is
// not a Modal, so there was no scrim to tap and nothing else on the
// screen could ever set it false. It was reported twice.
//
// The fix is not a third flag. Every dismissal a picker can need lives
// here: choosing a date closes it, Done closes it, and on Android the
// native dialog's own cancel closes it. A caller that renders this cannot
// create a surface with no exit, which is the only kind of fix that
// stops the bug coming back in the next picker someone adds.
export default function DatePicker({
  value, onPick, onClose, label = "Done",
}: {
  /** ISO date, "YYYY-MM-DD". */
  value: string;
  onPick: (iso: string) => void;
  onClose: () => void;
  label?: string;
}) {
  return (
    <View style={styles.wrap}>
      <DateTimePicker
        value={new Date(value + "T00:00:00")}
        mode="date"
        display={Platform.OS === "ios" ? "inline" : "default"}
        themeVariant="dark"
        onChange={(event, d) => {
          // Android reports its own cancel as a dismissed event with no
          // date; iOS inline just reports the new date.
          if (!d || (event as { type?: string })?.type === "dismissed") { onClose(); return; }
          onPick(d.toISOString().slice(0, 10));
          onClose();
        }}
      />
      {/* The way out when you opened it by mistake. On Android the dialog
          is its own surface and already has one, but an extra button that
          does the same thing is cheaper than a platform branch nobody
          exercises. */}
      <Pressable style={styles.done} onPress={onClose} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={styles.doneText}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: T.border, padding: 12, paddingBottom: 30 },
  done: { alignSelf: "flex-end", minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  doneText: { color: T.brass, fontSize: 15, fontWeight: "700" },
});
