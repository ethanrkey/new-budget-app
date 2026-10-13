import { useState } from "react";
import { Alert, LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { T, money } from "../lib/theme";
import type { BalanceSnapshot } from "../../src/engine/types.ts";

const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

// A logged balance is a statement you made, and a wrong one has to be
// correctable — the web has always allowed it. Tapping a row edits it;
// the row's own ✕ deletes it behind a native destructive confirm, the
// same treatment the scope sheet gives a delete.
//
// `kind` exists because this list now serves two things that are the
// same shape and NOT the same sentence. A reading is what an account
// was worth on a date; a contribution is money you put in on a date.
// Calling a contribution a "reading" in the confirm would be asking
// someone to approve deleting something other than what they tapped.
const COPY = {
  reading: {
    show: "history",
    confirmTitle: "Delete this reading?",
    confirmBody: "The chart and every total built on it change.",
  },
  contribution: {
    show: "contributions",
    confirmTitle: "Delete this contribution?",
    confirmBody: "What you put in this year changes. The account's balance does not — that is logged separately.",
  },
} as const;

export default function HistoryList({
  entries, online, onEdit, onDelete, kind = "reading",
}: {
  entries: BalanceSnapshot[];
  online: boolean;
  onEdit: (e: BalanceSnapshot) => void;
  onDelete: (e: BalanceSnapshot) => void;
  kind?: keyof typeof COPY;
}) {
  const [open, setOpen] = useState(false);
  const copy = COPY[kind];
  if (entries.length === 0) return null;
  const confirmDelete = (e: BalanceSnapshot) =>
    Alert.alert(
      copy.confirmTitle,
      `${money(e.amount)} on ${e.date}. ${copy.confirmBody}`,
      [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => onDelete(e) }]
    );
  return (
    <View>
      <Pressable onPress={() => { animate(); setOpen((v) => !v); }} style={styles.showBtn}>
        <Text style={styles.showText}>
          {open ? `Hide ${copy.show}` : `Show ${copy.show} (${entries.length})`}
        </Text>
      </Pressable>
      {open && (
        <View style={styles.histWrap}>
          {[...entries].reverse().map((e) => (
            <View key={e.id} style={styles.histRow}>
              <Pressable
                style={styles.histTap}
                disabled={!online}
                onPress={() => onEdit(e)}
                accessibilityRole="button"
                accessibilityLabel={`Edit the reading of ${money(e.amount)} on ${e.date}`}
              >
                <Text style={styles.histDate}>{e.date}</Text>
                <Text style={styles.histAmt}>{money(e.amount)}</Text>
              </Pressable>
              <Pressable
                style={styles.histDel}
                disabled={!online}
                onPress={() => confirmDelete(e)}
                accessibilityRole="button"
                accessibilityLabel={`Delete the reading of ${money(e.amount)} on ${e.date}`}
              >
                <Text style={[styles.histDelText, !online && { color: T.faint }]}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  showBtn: { minHeight: 40, justifyContent: "center" },
  showText: { color: T.brass, fontSize: 13 },
  histWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.border, marginTop: 2 },
  histRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
  histTap: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  histDate: { color: T.dim, fontSize: 12, fontVariant: ["tabular-nums"] },
  histAmt: { color: T.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  histDel: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  histDelText: { color: T.expense, fontSize: 15 },
});
