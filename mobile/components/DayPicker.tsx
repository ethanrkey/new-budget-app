import { Picker } from "@react-native-picker/picker";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";
import { DAY_OPTIONS } from "../../src/content/setup.ts";

// A day of the MONTH, 1 to 31, on a wheel.
//
// THE BUG THIS EXISTS FOR, reported from a device on build 8: the due
// day was a two-character number pad field, and you could enter 50.
// The engine clamped it to 31 afterwards, so nothing broke — it just
// silently meant something other than what was typed, which is worse
// than a rejection. A control that cannot express 50 is the honest
// fix, and it also retires `selectTextOnFocus` and `maxLength={2}` and
// the whole problem of a prefilled field that swallows the first
// keystroke.
//
// It is a `UIPickerView` rather than a grid of 31 chips because that
// is what iOS uses for an ordered one-of-many, and because the
// payday question next to it already opens a wheel — two controls
// asking "which day" should not be two different gestures.
//
// SAME CONTRACT AS DatePicker, deliberately: value in, onPick, and an
// onClose that every dismissal goes through, so a caller cannot build
// a surface with no way out. That rule was written after the Ledger's
// horizon chip shipped a picker that could not be closed at all.
export default function DayPicker({
  value, onPick, onClose, label = "Done",
}: {
  /** The day, 1-31. */
  value: number;
  onPick: (day: number) => void;
  onClose: () => void;
  label?: string;
}) {
  return (
    <View style={styles.wrap}>
      <Picker
        testID="day-picker"
        selectedValue={value}
        // CLOSES ON SELECTION, like the date picker. A UIPickerView
        // reports a value when the wheel SETTLES, not while it spins,
        // so one flick is one call and one call is the answer.
        onValueChange={(v) => { onPick(Number(v)); onClose(); }}
        itemStyle={styles.item}
      >
        {DAY_OPTIONS.map((d) => (
          <Picker.Item key={d} label={String(d)} value={d} color={T.text} />
        ))}
      </Picker>
      <Pressable style={styles.done} onPress={onClose} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={styles.doneText}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderColor: T.border, padding: 12, paddingBottom: 30, marginTop: 6,
  },
  item: { color: T.text, fontSize: 20 },
  done: { alignSelf: "flex-end", minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  doneText: { color: T.brass, fontSize: 15, fontWeight: "700" },
});
