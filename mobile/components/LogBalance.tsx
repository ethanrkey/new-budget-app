import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import DatePicker from "./DatePicker";
import { T, money } from "../lib/theme";
import { todayISO } from "../../src/engine/model.ts";
import { HIDDEN_ROWS_COPY as HIDDEN } from "../../src/content/logBalance.ts";
import { fmtDate } from "../../src/shared/dates.ts";

// The first write surface on the phone, and the right one to be first:
// logging a balance is what you do standing in front of your bank app,
// which is exactly when the laptop is not open.
//
// The copy carries the same warning the web's Update balance does, for
// the same reason: setting an as-of date drops every earlier transaction
// from the ledger, so a bill you still owe can vanish from the forecast.
/** The bits of a ledger row the confirmation needs to name one. */
export type HiddenRow = { id: string; name: string; date: string; amount: number };

export default function LogBalance({
  title, currentLabel, cta, warn, busy, onSubmit, onClose, hiddenRows,
}: {
  title: string; currentLabel?: string; cta: string; warn?: boolean;
  busy: boolean; onSubmit: (amount: number, date: string) => void; onClose: () => void;
  /** Rows that would drop off the Ledger if the anchor moved to this
   *  date. Only the checking balance passes it — a tracked account's
   *  reading does not move the forecast's starting point. */
  hiddenRows?: (date: string) => HiddenRow[];
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [picking, setPicking] = useState(false);
  // The rows about to disappear, once the user has pressed Confirm and
  // there turned out to be some. Null means "not asked yet".
  const [confirming, setConfirming] = useState<HiddenRow[] | null>(null);
  const parsed = amount.trim() === "" ? null : Number(amount);
  const valid = parsed != null && !Number.isNaN(parsed);

  // A BACK-DATED LOG THAT HIDES NOTHING GETS NO PROMPT. The warning
  // earns its interruption by naming specific rows; shown when there
  // are none it is noise, and noise is how a warning stops being read.
  function submit() {
    if (!valid) return;
    const dropping = hiddenRows?.(date) ?? [];
    if (dropping.length > 0 && confirming == null) { setConfirming(dropping); return; }
    onSubmit(parsed!, date);
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.scrim}
      >
        <View style={styles.card}>
          {confirming ? (
            <>
              <Text style={styles.title}>{HIDDEN.title}</Text>
              <Text style={styles.dim}>{HIDDEN.lede(confirming.length, date)}</Text>
              <ScrollView style={styles.hiddenList} contentContainerStyle={{ paddingVertical: 4 }}>
                {confirming.map((r) => (
                  <View key={r.id} style={styles.hiddenRow}>
                    <Text style={styles.hiddenDate}>{fmtDate(r.date)}</Text>
                    <Text style={styles.hiddenName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.hiddenAmount}>{money(r.amount)}</Text>
                  </View>
                ))}
              </ScrollView>
              <Text style={styles.hiddenWhy}>{HIDDEN.why}</Text>
              <Text style={styles.hiddenEscape}>{HIDDEN.escape}</Text>
              <View style={styles.row}>
                <Pressable
                  style={[styles.btn, styles.ghost]} onPress={onClose} disabled={busy}
                  accessibilityRole="button" accessibilityLabel={HIDDEN.cancel}
                >
                  <Text style={styles.ghostText}>{HIDDEN.cancel}</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.primary, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => onSubmit(parsed!, date)}
                  accessibilityRole="button" accessibilityLabel={HIDDEN.confirm}
                >
                  {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.primaryText}>{HIDDEN.confirm}</Text>}
                </Pressable>
              </View>
            </>
          ) : (
          <>
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
            accessibilityLabel={`As of ${fmtDate(date)}. Change the date.`}
          >
            <Text style={{ color: T.text, fontSize: 16 }}>{fmtDate(date)}</Text>
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
            {/* Both buttons carry a role and a label. They did not, so
                VoiceOver read the one that writes a balance as an
                unlabeled button — and a test could not find it either,
                which is how the gap surfaced. */}
            <Pressable
              style={[styles.btn, styles.ghost]} onPress={onClose} disabled={busy}
              accessibilityRole="button" accessibilityLabel="Cancel"
            >
              <Text style={styles.ghostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.primary, (!valid || busy) && styles.disabled]}
              disabled={!valid || busy}
              onPress={submit}
              accessibilityRole="button" accessibilityLabel={cta}
            >
              {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.primaryText}>{cta}</Text>}
            </Pressable>
          </View>
          </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const currently = (balance: number | null, asOf: string | null) =>
  balance == null ? undefined : `Currently ${money(balance)}, verified ${fmtDate(asOf)}`;

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: T.border, padding: 20, paddingBottom: 34, gap: 6 },
  title: { color: T.text, fontSize: 17, fontWeight: "700" },
  dim: { color: T.faint, fontSize: 12, marginBottom: 4 },
  hiddenList: { maxHeight: 190, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: T.border },
  hiddenRow: { flexDirection: "row", alignItems: "baseline", gap: 10, paddingVertical: 6 },
  hiddenDate: { color: T.faint, fontSize: 12, width: 78, fontVariant: ["tabular-nums"] },
  hiddenName: { color: T.text, fontSize: 13, flex: 1 },
  hiddenAmount: { color: T.dim, fontSize: 13, fontVariant: ["tabular-nums"] },
  hiddenWhy: { color: T.dim, fontSize: 12, lineHeight: 17, marginTop: 12 },
  hiddenEscape: { color: T.brass, fontSize: 12, lineHeight: 17, marginTop: 8 },
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
