import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";
import type { ScopeAction } from "../lib/edit";
import * as feel from "../lib/haptics";
import { fmtDate } from "../../src/shared/dates.ts";

// WHAT DO YOU MEAN, asked before the editor opens.
//
// The web puts this inside the form as a segmented control. A phone should
// not: a form whose fields appear and disappear as you flip a toggle at the
// top is hard to follow on a 390px screen, and iOS already has an answer
// people know — tap a repeating event in Calendar and it asks first. Scope
// chosen up front means the editor that follows has no mode at all and
// shows only the fields that scope can change.
//
// ORDER IS THE DEFAULT. "This date" is first because the two mistakes are
// not symmetric: someone meaning the rule who changes one date notices next
// month, while someone meaning one date who rewrites the rule silently
// changes months they already reconciled. The recoverable error is the one
// that should happen by accident.
//
// DELETE IS HERE TOO, and carries the same ambiguity as edit. It is
// answered the same way — by naming what goes. "Delete every Rent" cannot
// be read as "delete Oct 12".
//
// This renders CONTENT ONLY — the Modal belongs to BottomSheet, one per
// screen, so that picking "edit" swaps what is inside a sheet that is
// already up rather than dismissing one modal and presenting another.
// See BottomSheet for the bug that taught us.

// A JUST-ONCE ITEM IS NOT A RULE, and must not be described as one.
// `edit-rule` and `delete-rule` are the actions a one-off gets —
// correctly, since the whole item IS the one occurrence — but they
// were drawn with the words written for a repeating item, so tapping
// a one-time BMV charge offered to "Edit every BMV" and warned that
// deleting it would remove "every date it generates". There is one
// date. Reported 2026-10-21.
//
// NO SUB-LINE ON THE ONE-OFF EDIT. The sub-lines exist to separate
// two readings of the same tap; with a single reading on offer,
// "Edit BMV" says everything the row has to say and a second line
// would be saying it twice.
function labelFor(a: ScopeAction, name: string, recurring: boolean): { text: string; sub?: string; destructive?: boolean } {
  switch (a.kind) {
    case "edit-occurrence":
      return { text: `Edit just ${fmtDate(a.date)}`, sub: "Every other date keeps the rule's amount" };
    case "edit-rule":
      return recurring
        ? { text: `Edit every ${name}`, sub: "Changes the rule, and so every date it generates" }
        : { text: `Edit ${name}` };
    case "reset-occurrence":
      return { text: `Reset ${fmtDate(a.date)} to the rule`, sub: "Drops this date's own amount" };
    case "delete-rule":
      return recurring
        ? { text: `Delete ${name}`, sub: "Removes the rule and every date it generates", destructive: true }
        : { text: `Delete ${name}`, sub: "Removes this transaction", destructive: true };
  }
}

export default function ScopeSheet({
  name, actions, recurring, onPick, onClose,
}: {
  name: string;
  actions: ScopeAction[];
  /** Whether the tapped row came from a rule. It decides the WORDS
   *  and nothing else — the actions a one-off gets are the same two. */
  recurring: boolean;
  onPick: (a: ScopeAction) => void;
  onClose: () => void;
}) {
  // The destructive step gets the platform's own confirm rather than an
  // in-sheet "are you sure" — it is the one interaction where looking
  // native matters, because that is what people have learned to read as
  // "this one is different".
  const choose = (a: ScopeAction) => {
    if (a.kind !== "delete-rule") { onPick(a); return; }
    feel.warning();
    Alert.alert(
      `Delete ${name}?`,
      recurring
        ? "This removes the rule and every date it generates, including any dates you gave their own amount."
        : "This removes it from your ledger.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => onPick(a) },
      ]
    );
  };

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{name}</Text>
      {actions.map((a, i) => {
        const { text, sub, destructive } = labelFor(a, name, recurring);
        return (
          <Pressable
            key={`${a.kind}-${i}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => choose(a)}
            accessibilityRole="button"
            accessibilityLabel={text}
          >
            <Text style={[styles.rowText, destructive && styles.destructive]}>{text}</Text>
            {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
          </Pressable>
        );
      })}
      <Pressable style={[styles.row, styles.cancel]} onPress={onClose} accessibilityRole="button">
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: T.border, paddingTop: 14, paddingBottom: 34, paddingHorizontal: 12 },
  heading: { color: T.faint, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7, paddingHorizontal: 8, paddingBottom: 8 },
  row: { minHeight: 56, justifyContent: "center", paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12 },
  pressed: { backgroundColor: T.surfaceAlt },
  rowText: { color: T.text, fontSize: 16 },
  rowSub: { color: T.faint, fontSize: 12, marginTop: 2 },
  destructive: { color: T.expense },
  cancel: { marginTop: 6, alignItems: "center", borderWidth: 1, borderColor: T.border },
  cancelText: { color: T.dim, fontSize: 15 },
});
