import { useState } from "react";
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
// NOTHING IS COMMITTED UNTIL DONE, SINCE BUILD 9'S DEVICE PASS, and
// this is the one place where this component DELIBERATELY DIFFERS
// from DatePicker next to it.
//
// Build 9 committed on `onValueChange` and closed the wheel with it,
// which is the date picker's behavior and the wrong behavior here.
// A `UIDatePicker` in `inline` mode is a calendar: you tap the 14th,
// and that tap is an answer. A `UIPickerView` is a WHEEL — it reports
// whatever row it coasts to a stop on, and scrolling past a number on
// the way to another one is not a choice. Worse, committing on settle
// also closed the wheel, so overshooting meant the picker shut on a
// value nobody picked and had to be reopened to correct.
//
// So the wheel moves a DRAFT, Done commits it, and Cancel — or
// walking away and pressing Continue — leaves the old value exactly
// where it was. Cancel is a real button rather than a tap-outside,
// because this picker expands inline underneath its row and there is
// no scrim to tap.
export default function DayPicker({
  value, onPick, onClose, label = "Done",
}: {
  /** The day, 1-31. The COMMITTED one: the wheel's position is local. */
  value: number;
  onPick: (day: number) => void;
  onClose: () => void;
  label?: string;
}) {
  // The wheel opens on whatever the row currently says, and it is
  // only ever mounted while it is open — the caller renders it behind
  // `{open && ...}` — so this initial value IS the reopen behavior.
  // An effect syncing `draft` to a changing `value` was here briefly
  // and was removed: nothing changes `value` underneath an open
  // picker, so no test could reach it and no mutation could kill it.
  const [draft, setDraft] = useState(value);

  return (
    <View style={styles.wrap}>
      <Picker
        testID="day-picker"
        selectedValue={draft}
        // A DRAFT, NOT THE ANSWER. See above: a wheel settling is not
        // a decision, and this one used to be both the decision and
        // the dismissal.
        onValueChange={(v) => setDraft(Number(v))}
        itemStyle={styles.item}
      >
        {DAY_OPTIONS.map((d) => (
          <Picker.Item key={d} label={String(d)} value={d} color={T.text} />
        ))}
      </Picker>
      <View style={styles.actions}>
        {/* Cancel first and muted, Done last and in the accent: the
            iOS order, where the dismissive action is the one your
            thumb does not land on by accident. */}
        <Pressable
          style={styles.action}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={styles.action}
          onPress={() => { onPick(draft); onClose(); }}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Text style={styles.doneText}>{label}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderColor: T.border, padding: 12, paddingBottom: 30, marginTop: 6,
  },
  item: { color: T.text, fontSize: 20 },
  actions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  action: { minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  cancelText: { color: T.dim, fontSize: 15 },
  doneText: { color: T.brass, fontSize: 15, fontWeight: "700" },
});
