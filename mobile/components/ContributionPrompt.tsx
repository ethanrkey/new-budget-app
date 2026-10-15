import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import DatePicker from "./DatePicker";
import { T } from "../lib/theme";
import { fmtDate } from "../../src/shared/dates.ts";
import { todayISO } from "../../src/engine/model.ts";
import { blankContributionRow, type ContributionRow } from "../../src/engine/setup.ts";
import {
  SETUP_COPY as COPY, CADENCE_OPTIONS, CONTRIBUTION_PROMPT as PROMPT,
} from "../../src/content/setup.ts";
import type { SetupCadence } from "../../src/engine/setup.ts";

// Setup's contributions step, for ONE account and reached a different
// way: this is what the Dashboard offers right after a savings,
// investment or debt account is added.
//
// SAME WORDS AND SAME RULE BUILDER as the step. The labels come from
// SETUP_COPY.contributions and the rule from contributionRuleFor, so
// an account added here and one added during setup produce the same
// thing, named the same way, starting on the same date.
//
// AN OFFER, AND IT SAYS SO. "Not now" is a real button rather than a
// scrim tap or an X: this arrives unasked for immediately after a
// save, and an offer with no visible way to decline is a demand.
export default function ContributionPrompt({
  category, busy, onSchedule, onClose,
}: {
  category: { id: string; name: string; kind: "asset" | "debt" };
  busy: boolean;
  onSchedule: (row: ContributionRow) => void;
  onClose: () => void;
}) {
  const today = todayISO();
  const [row, setRow] = useState<ContributionRow>(() => blankContributionRow(today));
  const [picking, setPicking] = useState(false);
  const set = (patch: Partial<ContributionRow>) => setRow((r) => ({ ...r, ...patch }));
  const isDebt = category.kind === "debt";
  const valid = Number(row.amount) > 0;

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.scrim}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{PROMPT.title(category.name)}</Text>
          <Text style={styles.dim}>{isDebt ? PROMPT.debtSub : PROMPT.sub}</Text>

          <Text style={styles.label}>
            {isDebt ? COPY.contributions.owedFor(category.name) : COPY.contributions.amountFor(category.name)}
          </Text>
          <TextInput
            style={styles.field}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={T.faint}
            value={row.amount}
            onChangeText={(v) => set({ amount: v })}
            autoFocus
            accessibilityLabel={`${category.name} contribution amount`}
          />

          <Text style={styles.label}>{COPY.labels.cadence}</Text>
          <View style={styles.chips}>
            {CADENCE_OPTIONS.map((c) => {
              const on = c.value === row.cadence;
              return (
                <Pressable
                  key={c.value}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => set({ cadence: c.value as SetupCadence })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={c.label}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* EVERY CADENCE GETS A FIRST DATE, matching the setup step
              this is the one-account version of. It used to be a day
              of the month shown only for a monthly contribution, so a
              weekly or biweekly one silently started today — the same
              day as the balance it is counted forward from. */}
          <Text style={styles.label}>
            {isDebt ? COPY.contributions.startLabelDebt : COPY.contributions.startLabel}
          </Text>
          <Pressable
            style={[styles.field, styles.pickRow]}
            onPress={() => setPicking(true)}
            accessibilityRole="button"
            accessibilityLabel={`${category.name} first contribution ${fmtDate(row.start)}. Change the date.`}
          >
            <Text style={styles.fieldText}>{fmtDate(row.start)}</Text>
            <Text style={styles.pickCue}>Change ›</Text>
          </Pressable>
          {picking && (
            <DatePicker
              value={row.start}
              minimum={today}
              onPick={(v) => set({ start: v < today ? today : v })}
              onClose={() => setPicking(false)}
            />
          )}

          <View style={styles.row}>
            <Pressable
              style={[styles.btn, styles.ghost]} onPress={onClose} disabled={busy}
              accessibilityRole="button" accessibilityLabel={PROMPT.skip}
            >
              <Text style={styles.ghostText}>{PROMPT.skip}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.primary, (!valid || busy) && styles.disabled]}
              disabled={!valid || busy}
              onPress={() => onSchedule(row)}
              accessibilityRole="button" accessibilityLabel={PROMPT.add}
            >
              {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.primaryText}>{PROMPT.add}</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  card: { backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: T.border, padding: 20, paddingBottom: 34 },
  title: { color: T.text, fontSize: 17, fontWeight: "700" },
  dim: { color: T.faint, fontSize: 12, lineHeight: 17, marginTop: 6 },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14 },
  field: { backgroundColor: T.bg, borderColor: T.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: T.text, fontSize: 16, minHeight: 48, marginTop: 6 },
  fieldText: { color: T.text, fontSize: 16 },
  pickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pickCue: { color: T.brass, fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", gap: 6, marginTop: 6 },
  chip: { flex: 1, borderWidth: 1, borderColor: T.border, backgroundColor: T.bg, borderRadius: 10, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  chipOn: { backgroundColor: T.text, borderColor: T.text },
  chipText: { color: T.dim, fontSize: 12, textAlign: "center" },
  chipTextOn: { color: T.bg, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, marginTop: 18 },
  btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: T.border },
  ghostText: { color: T.dim, fontSize: 15 },
  primary: { backgroundColor: T.brass },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
