import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import DatePicker from "./DatePicker";
import { T, money } from "../lib/theme";
import { todayISO } from "../../src/engine/model.ts";

// The first write surface on the phone, and the right one to be first:
// logging a balance is what you do standing in front of your bank app,
// which is exactly when the laptop is not open.
//
// The copy carries the same warning the web's Update balance does, for
// the same reason: setting an as-of date drops every earlier transaction
// from the ledger, so a bill you still owe can vanish from the forecast.
export default function LogBalance({
  title, currentLabel, cta, warn, busy, onSubmit, onClose,
}: {
  title: string; currentLabel?: string; cta: string; warn?: boolean;
  busy: boolean; onSubmit: (amount: number, date: string) => void; onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [picking, setPicking] = useState(false);
  const parsed = amount.trim() === "" ? null : Number(amount);
  const valid = parsed != null && !Number.isNaN(parsed);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.scrim}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {currentLabel ? <Text style={styles.dim}>{currentLabel}</Text> : null}

          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={styles.field}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={T.faint}
            value={amount}
            onChangeText={setAmount}
            autoFocus
          />

          <Text style={styles.label}>As of</Text>
          <Pressable
            style={styles.field}
            onPress={() => setPicking(true)}
            accessibilityRole="button"
            accessibilityLabel={`As of ${date}. Change the date.`}
          >
            <Text style={{ color: T.text, fontSize: 16 }}>{date}</Text>
          </Pressable>
          {picking && (
            <DatePicker value={date} onPick={setDate} onClose={() => setPicking(false)} />
          )}

          {warn && (
            <Text style={styles.warn}>
              Transactions dated before this will drop out of the ledger, since the balance already
              accounts for them — make sure none of them are bills you still owe.
            </Text>
          )}

          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.ghost]} onPress={onClose} disabled={busy}>
              <Text style={styles.ghostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.primary, (!valid || busy) && styles.disabled]}
              disabled={!valid || busy}
              onPress={() => onSubmit(parsed!, date)}
            >
              {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.primaryText}>{cta}</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const currently = (balance: number | null, asOf: string | null) =>
  balance == null ? undefined : `Currently ${money(balance)}, verified ${asOf}`;

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: T.border, padding: 20, paddingBottom: 34, gap: 6 },
  title: { color: T.text, fontSize: 17, fontWeight: "700" },
  dim: { color: T.faint, fontSize: 12, marginBottom: 4 },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8 },
  field: { backgroundColor: T.bg, borderColor: T.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: T.text, fontSize: 16, minHeight: 48, justifyContent: "center" },
  warn: { color: T.dim, fontSize: 12, lineHeight: 17, marginTop: 10 },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: T.border },
  ghostText: { color: T.dim, fontSize: 15 },
  primary: { backgroundColor: T.brass },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
