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
  value, onPick, onClose, label = "Done", minimum,
}: {
  /** ISO date, "YYYY-MM-DD". */
  value: string;
  onPick: (iso: string) => void;
  onClose: () => void;
  label?: string;
  /** Earliest selectable date, ISO. Used by the payday question,
   *  where a date that has already gone is never the answer. */
  minimum?: string;
}) {
  return (
    <View style={styles.wrap} testID="date-picker-panel">
      <DateTimePicker
        value={new Date(value + "T00:00:00")}
        mode="date"
        minimumDate={minimum ? new Date(minimum + "T00:00:00") : undefined}
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
  // ALL FOUR CORNERS, AT THE FIELDS' OWN RADIUS, since 2026-10-16.
  // Reported from a device on build 11: the top two were rounded at 20
  // and the bottom two were square, so the panel read as cut off
  // rather than as a thing sitting on the form. Top-only rounding is
  // right for the bottom SHEETS in this app — their bottom corners are
  // off the screen — and wrong for a panel that floats inline between
  // two text fields. 12 is `styles.input`'s radius in Setup.tsx, which
  // is what it has to match: a panel rounder than the field above it
  // reads as a different family of object.
  wrap: { backgroundColor: T.surface, borderRadius: 12, borderWidth: 1, borderColor: T.border, padding: 12, paddingBottom: 30 },
  done: { alignSelf: "flex-end", minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  doneText: { color: T.brass, fontSize: 15, fontWeight: "700" },
});
