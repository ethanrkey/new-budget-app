import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import FormSheet, { useDiscardGuard } from "./FormSheet";
import { DISCARD_ACCOUNT } from "../../src/content/logBalance.ts";
import { T } from "../lib/theme";
import { FIELD_TEXT } from "../lib/fields";
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
  // CHANGED, not merely opened: this sheet starts holding the loan's
  // own terms, so emptiness is no test of whether anything was typed.
  const dirty = name !== cat.name
    || original !== (cat.originalPrincipal != null ? String(cat.originalPrincipal) : "")
    || rate !== (cat.interestRate != null ? String(cat.interestRate) : "")
    || from !== (cat.interestStartDate ?? "");
  const requestClose = useDiscardGuard(dirty, DISCARD_ACCOUNT, onClose);

  // HAS SAVE BEEN PRESSED? A loan the card is prompting for terms on
  // opens with no original amount — that is why the prompt exists —
  // and this sheet used to greet it with "Enter the original loan
  // amount." before a key was pressed. The error waits for the
  // attempt, like CategorySheet's and the transaction form's.
  const [tried, setTried] = useState(false);

  const num = (v: string) => Number(v.trim());
  const error =
    !name.trim() ? "Give it a name."
    : original.trim() === "" || Number.isNaN(num(original)) ? "Enter the original loan amount."
    : rate.trim() !== "" && Number.isNaN(num(rate)) ? "The rate has to be a number."
    : null;

  if (picking) {
    return <DatePicker value={from || new Date().toISOString().slice(0, 10)} onPick={setFrom} onClose={() => setPicking(false)} />;
  }

  // ITS OWN SHEET NOW, not content inside the Dashboard's BottomSheet.
  // It is a form with four fields, so it gets the same presentation
  // and the same guard as every other form — see FormSheet.
  return (
    <FormSheet onRequestClose={requestClose} dirty={dirty}>
      <>
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

        {tried && error ? <Text style={styles.err}>{error}</Text> : null}
        <View style={styles.row}>
          <Pressable style={[styles.btn, styles.ghost]} onPress={requestClose} disabled={busy} accessibilityRole="button">
            <Text style={styles.ghostText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.primary, busy && styles.disabled]}
            disabled={busy}
            // Validate ON PRESS rather than disabling the button — see
            // CategorySheet, which has made the same case since it was
            // written.
            onPress={() => {
              setTried(true);
              if (error) return;
              onSave({
                name: name.trim(),
                originalPrincipal: Math.abs(num(original)),
                interestRate: rate.trim() === "" ? null : Math.abs(num(rate)),
                interestStartDate: from || null,
              });
            }}
            accessibilityRole="button" accessibilityLabel="Save"
          >
            {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.primaryText}>Save</Text>}
          </Pressable>
        </View>
      </>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  // No card and no maxHeight: a page sheet is both, and FormSheet
  // owns the padding and the scroller.
  title: { color: T.text, fontSize: 17, fontWeight: "700" },
  dim: { color: T.faint, fontSize: 12, lineHeight: 17, marginBottom: 4 },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 10, marginBottom: 4 },
  field: { ...FIELD_TEXT, backgroundColor: T.bg, borderColor: T.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: T.text, fontSize: 16, minHeight: 48, justifyContent: "center" },
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
