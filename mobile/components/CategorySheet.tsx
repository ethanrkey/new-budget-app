import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import DatePicker from "./DatePicker";
import { T } from "../lib/theme";
import {
  type CategoryDraft, categoryDraftError,
} from "../lib/categories";
import { fmtDate } from "../../src/shared/dates.ts";

// Add or edit one savings account, investment or loan.
//
// This is the form behind the thing the phone could not do at all: a
// phone-only user had no way to create a tracked account, and no way to
// answer the prompt the loan card itself makes for a rate and an
// original amount.
//
// ONE FORM FOR ALL THREE, because they are one thing with a flag. The
// web has two modals (AssetSetupModal, LoanSetupModal) and a third
// screen that creates bare categories, which is three places to keep in
// step; the kind picker at the top does the same work in one. The
// fields below it change with the kind, so nothing irrelevant is ever
// on screen.
//
// The validation is in lib/categories.ts and is deliberately permissive
// about terms — see the reasoning there. A form stricter than the data
// model is unusable for the person whose paperwork is in another room.
export default function CategorySheet({
  title, draft: initial, creating, busy, onSave, onClose,
}: {
  title: string;
  draft: CategoryDraft;
  /** Adding, as opposed to editing. It changes one field's existence. */
  creating: boolean;
  busy: boolean;
  onSave: (d: CategoryDraft) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [picking, setPicking] = useState<"asOf" | "interestStart" | null>(null);
  const [showError, setShowError] = useState(false);
  const set = <K extends keyof CategoryDraft>(k: K, v: CategoryDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const error = categoryDraftError(d, creating);
  const debt = d.kind === "debt";

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.scrim}
      >
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{title}</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.field}
              // A KIND OF THING, NEVER A BRAND, and the same examples
              // the web's AssetSetupModal gives. This said "Ally
              // Savings" until 2026-10-15, which is a real bank this
              // app has nothing to do with.
              placeholder="Emergency fund, Roth IRA, Car loan…"
              placeholderTextColor={T.faint}
              value={d.name}
              onChangeText={(v) => set("name", v)}
              accessibilityLabel="Name"
              autoFocus
            />

            {/* THE KIND PICKER IS THE WHOLE FORM'S SHAPE, so it is first
                and it is three plain buttons rather than a dropdown — on
                a phone a three-option dropdown is two taps to see what a
                row of chips says at a glance. */}
            <Text style={styles.label}>What is it</Text>
            <View style={styles.chips}>
              {([
                ["asset", "savings", "Savings"],
                ["asset", "investment", "Investment"],
                ["debt", "savings", "Loan or debt"],
              ] as const).map(([kind, assetKind, label]) => {
                const on = d.kind === kind && (kind === "debt" || d.assetKind === assetKind);
                return (
                  <Pressable
                    key={label}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => setD((p) => ({ ...p, kind, assetKind }))}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={label}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {debt && (
              <>
                {/* Terms are optional and the hint says so, because the
                    card prompts for them and someone reaching this form
                    from that prompt should not be blocked by not having
                    the paperwork to hand. */}
                <Text style={styles.label}>Original amount (optional)</Text>
                <TextInput
                  style={styles.field}
                  keyboardType="decimal-pad"
                  placeholder="14200"
                  placeholderTextColor={T.faint}
                  value={d.originalPrincipal}
                  onChangeText={(v) => set("originalPrincipal", v)}
                  accessibilityLabel="Original amount"
                />

                <Text style={styles.label}>Interest rate % (optional)</Text>
                <TextInput
                  style={styles.field}
                  keyboardType="decimal-pad"
                  placeholder="6.4"
                  placeholderTextColor={T.faint}
                  value={d.interestRate}
                  onChangeText={(v) => set("interestRate", v)}
                  accessibilityLabel="Interest rate"
                />

                {d.originalPrincipal.trim() !== "" && (
                  <>
                    <Text style={styles.label}>Interest started</Text>
                    <Pressable
                      style={styles.field}
                      onPress={() => setPicking("interestStart")}
                      accessibilityRole="button"
                      accessibilityLabel={`Interest started ${d.interestStartDate}. Change the date.`}
                    >
                      <Text style={styles.fieldText}>{d.interestStartDate}</Text>
                    </Pressable>
                  </>
                )}
              </>
            )}

            {/* THE BALANCE EXISTS ONLY WHEN CREATING. On an edit it is
                not optional, it is absent: balances change through Log,
                which dates them. The old form offered "What's in it
                (optional)" on both, so editing a name meant looking at
                a balance box reading 0.00 for an account that holds
                thousands — a question nobody asked whose obvious
                answer would have written a $0 reading. */}
            {creating && (
              <>
                <Text style={styles.label}>Current balance</Text>
                <TextInput
                  style={styles.field}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={T.faint}
                  value={d.balance}
                  onChangeText={(v) => set("balance", v)}
                  accessibilityLabel="Current balance"
                />

                {/* The as-of date only exists once there is a number to
                    date. A date for nothing is how an empty reading
                    gets written. */}
                {d.balance.trim() !== "" && (
                  <>
                    <Text style={styles.label}>As of</Text>
                    <Pressable
                      style={styles.field}
                      onPress={() => setPicking("asOf")}
                      accessibilityRole="button"
                      accessibilityLabel={`As of ${fmtDate(d.asOf)}. Change the date.`}
                    >
                      <Text style={styles.fieldText}>{fmtDate(d.asOf)}</Text>
                    </Pressable>
                  </>
                )}
              </>
            )}

            {picking && (
              <DatePicker
                value={picking === "asOf" ? d.asOf : d.interestStartDate}
                onPick={(v) => set(picking === "asOf" ? "asOf" : "interestStartDate", v)}
                onClose={() => setPicking(null)}
              />
            )}

            {showError && error ? <Text style={styles.err}>{error}</Text> : null}

            <View style={styles.row}>
              <Pressable style={[styles.btn, styles.ghost]} onPress={onClose} disabled={busy}
                accessibilityRole="button" accessibilityLabel="Cancel">
                <Text style={styles.ghostText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.primary, busy && styles.disabled]}
                disabled={busy}
                // Validate ON PRESS rather than disabling the button.
                // A disabled button with no explanation is the thing
                // people tap twice and then give up on; this one always
                // responds, and says what is wrong.
                onPress={() => { setShowError(true); if (!error) onSave(d); }}
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.primaryText}>Save</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: {
    maxHeight: "92%", backgroundColor: T.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: T.border,
  },
  inner: { padding: 20, paddingBottom: 34, gap: 4 },
  title: { color: T.text, fontSize: 17, fontWeight: "700", marginBottom: 4 },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 10 },
  field: {
    backgroundColor: T.bg, borderColor: T.border, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, color: T.text, fontSize: 16,
    minHeight: 48, justifyContent: "center",
  },
  fieldText: { color: T.text, fontSize: 16 },
  chips: { flexDirection: "row", gap: 6, marginTop: 6 },
  chip: {
    flex: 1, borderWidth: 1, borderColor: T.border, backgroundColor: T.bg,
    borderRadius: 10, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6,
  },
  chipOn: { backgroundColor: T.text, borderColor: T.text },
  chipText: { color: T.dim, fontSize: 13, textAlign: "center" },
  chipTextOn: { color: T.bg, fontWeight: "700" },
  err: { color: T.expense, fontSize: 13, marginTop: 10 },
  row: { flexDirection: "row", gap: 10, marginTop: 18 },
  btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: T.border },
  ghostText: { color: T.dim, fontSize: 15 },
  primary: { backgroundColor: T.brass },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
