import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";
import { ledgerToCSV, budgetToCSV } from "../../src/engine/csv.ts";
import { computeLedger, computeBudget } from "../../src/engine/compute.ts";
import { ledgerHorizonOf } from "../../src/engine/model.ts";
import type { BudgetState } from "../../src/engine/types.ts";

// Export, on a phone, is the SHARE SHEET — not a download.
//
// A browser download has nowhere to land on iOS, so the platform answer
// is to hand the text to whatever the person already uses to move things
// off the device: Files, Mail, Notes, AirDrop. One API, no permissions,
// no file picker to get wrong.
//
// Three exports, same shapes the web produces, from the same engine
// functions — so a CSV off the phone and a CSV off the laptop are the
// same bytes for the same data, and the full backup is restorable by the
// web's Import → Restore without a second format to maintain.
export default function ExportSheet({ state, onClose }: { state: BudgetState; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async (key: string, title: string, body: string) => {
    setBusy(key);
    setFailed(null);
    try {
      await Share.share({ message: body, title });
    } catch (e) {
      // A share the person dismisses is not a failure; a share that
      // throws is, and silence is the one thing it must not do.
      setFailed((e as Error).message || "Could not open the share sheet.");
    } finally {
      setBusy(null);
    }
  };

  const horizon = ledgerHorizonOf(state);
  const rows: { key: string; label: string; hint: string; build: () => { title: string; body: string } }[] = [
    {
      key: "ledger", label: "Ledger (CSV)",
      hint: "Every projected transaction in the current window, with its running balance.",
      build: () => ({ title: "Ledger.csv", body: ledgerToCSV(computeLedger(state, horizon), state.trackerCategories) }),
    },
    {
      key: "budget", label: "Budget (CSV)",
      hint: "The monthly grid, as a spreadsheet.",
      build: () => ({ title: "Budget.csv", body: budgetToCSV(computeBudget(state, state.settings.budgetHorizon), state.trackerCategories) }),
    },
    {
      key: "backup", label: "Full backup (JSON)",
      hint: "Everything: rules, categories, every logged balance and contribution. This is the one that is actually a backup — the web's Import can restore it.",
      build: () => ({ title: "key-budget-backup.json", body: JSON.stringify(state, null, 2) }),
    },
  ];

  return (
    <View style={styles.card}>
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={styles.title}>Export</Text>
        <Text style={styles.dim}>
          Your data, handed to the share sheet — save it to Files, mail it to yourself, whatever you
          already use. Nothing leaves the phone until you choose where it goes.
        </Text>

        {rows.map((r) => (
          <Pressable
            key={r.key}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            disabled={busy !== null}
            onPress={() => { const { title, body } = r.build(); void send(r.key, title, body); }}
            accessibilityRole="button"
            accessibilityLabel={r.label}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowText}>{r.label}</Text>
              <Text style={styles.rowSub}>{r.hint}</Text>
            </View>
            {busy === r.key ? <ActivityIndicator color={T.brass} /> : <Text style={styles.chev}>›</Text>}
          </Pressable>
        ))}

        {failed ? <Text style={styles.err}>{failed}</Text> : null}

        <Pressable style={[styles.row, styles.cancel]} onPress={onClose} accessibilityRole="button">
          <Text style={styles.cancelText}>Done</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { maxHeight: "88%", backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: T.border },
  inner: { padding: 16, paddingBottom: 34 },
  title: { color: T.text, fontSize: 17, fontWeight: "700", paddingHorizontal: 4 },
  dim: { color: T.faint, fontSize: 12, lineHeight: 17, paddingHorizontal: 4, marginTop: 4, marginBottom: 10 },
  row: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12 },
  pressed: { backgroundColor: T.surfaceAlt },
  rowText: { color: T.text, fontSize: 15 },
  rowSub: { color: T.faint, fontSize: 12, lineHeight: 16, marginTop: 2 },
  chev: { color: T.faint, fontSize: 20 },
  err: { color: T.expense, fontSize: 13, paddingHorizontal: 4, marginTop: 8 },
  cancel: { marginTop: 8, justifyContent: "center", borderWidth: 1, borderColor: T.border },
  cancelText: { color: T.dim, fontSize: 15, textAlign: "center" },
});
