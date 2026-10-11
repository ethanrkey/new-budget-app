import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { T } from "../lib/theme";
import { todayISO } from "../../src/engine/model.ts";
import { ledgerToCSV, budgetToCSV } from "../../src/engine/csv.ts";
import { computeLedger, computeBudget } from "../../src/engine/compute.ts";
import { ledgerHorizonOf } from "../../src/engine/model.ts";
import type { BudgetState } from "../../src/engine/types.ts";

// Export, on a phone, is the SHARE SHEET — not a download.
//
// A browser download has nowhere to land on iOS, so the platform answer
// is to hand the data to whatever the person already uses to move things
// off the device: Files, Mail, Notes, AirDrop.
//
// IT HAS TO BE A FILE, not a message. The first version passed the CSV
// as `Share.share({ message })`, which is a string with no name and no
// type — "Save to Files" wrote it as a file literally called `text`,
// with no extension, which no spreadsheet will open by double-clicking.
// `title` did nothing, because RN's Share only uses it on Android.
// Found on a device 2026-10-11. So: write a real file to the cache with
// a real name, and share its uri. The name carries the date, because
// an export is a snapshot and two of them in a downloads folder are
// otherwise indistinguishable.
//
// Three exports, same shapes the web produces, from the same engine
// functions — so a CSV off the phone and a CSV off the laptop are the
// same bytes for the same data, and the full backup is restorable by the
// web's Import → Restore without a second format to maintain.
export default function ExportSheet({ state, onClose }: { state: BudgetState; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async (key: string, filename: string, body: string, mimeType: string, uti: string) => {
    setBusy(key);
    setFailed(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setFailed("This device cannot open a share sheet.");
        return;
      }
      // The cache, not documents: an export is a thing on its way out,
      // and leaving copies in a directory iOS never reclaims would grow
      // forever. Deleting first makes a second export of the same day
      // overwrite rather than fail.
      const file = new File(Paths.cache, filename);
      try { file.delete(); } catch { /* first export of the day */ }
      file.create();
      file.write(body);
      await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle: filename });
    } catch (e) {
      // A share the person dismisses is not a failure; a share that
      // throws is, and silence is the one thing it must not do.
      setFailed((e as Error).message || "Could not open the share sheet.");
    } finally {
      setBusy(null);
    }
  };

  const horizon = ledgerHorizonOf(state);
  const stamp = todayISO();
  const CSV = { mimeType: "text/csv", uti: "public.comma-separated-values-text" };
  const JSON_ = { mimeType: "application/json", uti: "public.json" };

  const rows: {
    key: string; label: string; hint: string;
    build: () => { filename: string; body: string; mimeType: string; uti: string };
  }[] = [
    {
      key: "ledger", label: "Ledger (CSV)",
      hint: "Every projected transaction in the current window, with its running balance.",
      build: () => ({
        filename: `key-budget-ledger-${stamp}.csv`, ...CSV,
        body: ledgerToCSV(computeLedger(state, horizon), state.trackerCategories),
      }),
    },
    {
      key: "budget", label: "Budget (CSV)",
      hint: "The monthly grid, as a spreadsheet.",
      build: () => ({
        filename: `key-budget-budget-${stamp}.csv`, ...CSV,
        body: budgetToCSV(computeBudget(state, state.settings.budgetHorizon), state.trackerCategories),
      }),
    },
    {
      key: "backup", label: "Full backup (JSON)",
      hint: "Everything: rules, categories, every logged balance and contribution. This is the one that is actually a backup — the web's Import can restore it.",
      build: () => ({
        filename: `key-budget-backup-${stamp}.json`, ...JSON_,
        body: JSON.stringify(state, null, 2),
      }),
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
            onPress={() => {
              const { filename, body, mimeType, uti } = r.build();
              void send(r.key, filename, body, mimeType, uti);
            }}
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
