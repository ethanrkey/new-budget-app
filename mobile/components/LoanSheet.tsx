import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { T } from "../lib/theme";
import DatePicker from "./DatePicker";
import type { TrackerCategory } from "../../src/engine/types.ts";

// A loan's TERMS, which the Dashboard's Edit button needs somewhere to go.
//
// It exists now because the card's spec has an Edit button and a button
// that does nothing is worse than no button — the web learned that with a
// color picker whose value was silently discarded.
//
// Deliberately NOT the full web modal: no delete, and no opening balance.
// Setting up a loan from scratch is still a laptop job (mobile backlog
// item 5); this edits a loan that already exists, which is the thing you
// reach for when you notice the APR is wrong.
export default function LoanSheet({
  cat, busy, onSave, onClose,
}: {
  cat: TrackerCategory & { originalPrincipal?: number | null; interestRate?: number | null; interestStartDate?: string | null };
  busy: boolean;
  onSave: (patch: { name: string; originalPrincipal: number; interestRate: number | null; interestStartDate: string | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(cat.name);
  const [original, setOriginal] = useState(cat.originalPrincipal != null ? String(cat.originalPrincipal) : "");
  const [rate, setRate] = useState(cat.interestRate != null ? String(cat.interestRate) : "");
  const [from, setFrom] = useState(cat.interestStartDate ?? "");
  const [picking, setPicking] = useState(false);

  const num = (v: string) => Number(v.trim());
  const error =
    !name.trim() ? "Give it a name."
    : original.trim() === "" || Number.isNaN(num(original)) ? "Enter the original loan amount."
    : rate.trim() !== "" && Number.isNaN(num(rate)) ? "The rate has to be a number."
    : null;

  if (picking) {
    return <DatePicker value={from || new Date().toISOString().slice(0, 10)} onPick={setFrom} onClose={() => setPicking(false)} />;
  }

  return (
    <View style={styles.card}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.inner}>
        <Text style={styles.title}>Edit {cat.name}</Text>
        <Text style={styles.dim}>
          The loan&apos;s terms. Payments toward it are ordinary transactions that pick it as their
          category — changing these never creates one.
        </Text>

        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.field} value={name} onChangeText={setName} accessibilityLabel="Name" />

        <Text style={styles.label}>Original loan amount</Text>
        <TextInput style={styles.field} keyboardType="decimal-pad" value={original}
          onChangeText={setOriginal} accessibilityLabel="Original loan amount" />

        <Text style={styles.label}>Interest rate (APR %)</Text>
        <TextInput style={styles.field} keyboardType="decimal-pad" value={rate}
          onChangeText={setRate} placeholder="e.g. 5.8" placeholderTextColor={T.faint}
          accessibilityLabel="Interest rate" />

        <Text style={styles.label}>Interest starts (optional)</Text>
        <View style={styles.row}>
          <Pressable style={[styles.field, { flex: 1 }]} onPress={() => setPicking(true)}
            accessibilityRole="button" accessibilityLabel="Interest start date">
            <Text style={{ color: from ? T.text : T.faint, fontSize: 16 }}>{from || "Not set"}</Text>
          </Pressable>
          {from ? (
            <Pressable onPress={() => setFrom("")} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear the interest start date">
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? <Text style={styles.err}>{error}</Text> : null}
        <View style={styles.row}>
          <Pressable style={[styles.btn, styles.ghost]} onPress={onClose} disabled={busy} accessibilityRole="button">
            <Text style={styles.ghostText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.primary, (!!error || busy) && styles.disabled]}
            disabled={!!error || busy}
            onPress={() => onSave({
              name: name.trim(),
              originalPrincipal: Math.abs(num(original)),
              interestRate: rate.trim() === "" ? null : Math.abs(num(rate)),
              interestStartDate: from || null,
            })}
            accessibilityRole="button" accessibilityLabel="Save"
          >
            {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.primaryText}>Save</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { maxHeight: "88%", backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: T.border },
  inner: { padding: 20, paddingBottom: 34, gap: 4 },
  title: { color: T.text, fontSize: 17, fontWeight: "700" },
  dim: { color: T.faint, fontSize: 12, lineHeight: 17, marginBottom: 4 },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 10, marginBottom: 4 },
  field: { backgroundColor: T.bg, borderColor: T.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: T.text, fontSize: 16, minHeight: 48, justifyContent: "center" },
  row: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 14 },
  clear: { paddingHorizontal: 12, minHeight: 48, justifyContent: "center" },
  clearText: { color: T.brass, fontSize: 14 },
  err: { color: T.expense, fontSize: 13, marginTop: 12 },
  btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: T.border },
  ghostText: { color: T.dim, fontSize: 15 },
  primary: { backgroundColor: T.brass },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
