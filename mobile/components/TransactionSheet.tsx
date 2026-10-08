import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { T, money } from "../lib/theme";
import { CADENCES } from "../../src/engine/model.ts";
import { blankDraft, draftOf, draftError, overrideError, canTrackActuals, type Draft } from "../lib/edit";
import type { BudgetItem, BudgetState, ISODate, Cadence } from "../../src/engine/types.ts";

// The editor. It has NO SCOPE CONTROL, which is the point of asking first:
// in occurrence mode it shows one field, because one field is all that
// scope can change, and in rule mode it shows the rule.
//
// Modelled on LogBalance, which is the write surface this app already had
// — same bottom sheet, same field styling, same disabled-while-saving
// behaviour, so the second thing you can write looks like the first.
const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", yearly: "Yearly",
};
const prettyDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export type SheetMode =
  | { kind: "add" }
  | { kind: "rule"; item: BudgetItem }
  | { kind: "occurrence"; item: BudgetItem; date: ISODate; current: number | null };

export default function TransactionSheet({
  mode, state, busy, orphanCount, onSaveDraft, onSaveOccurrence, onClose,
}: {
  mode: SheetMode;
  state: BudgetState;
  busy: boolean;
  /** How many date-specific amounts this save would orphan, computed by the
   *  caller from the live draft. Shown BEFORE saving, never after. */
  orphanCount: (d: Draft) => number;
  onSaveDraft: (d: Draft) => void;
  onSaveOccurrence: (amount: string) => void;
  onClose: () => void;
}) {
  const existing = mode.kind === "add" ? null : mode.item;
  const [draft, setDraft] = useState<Draft>(() => (existing ? draftOf(existing) : blankDraft()));
  const [occAmount, setOccAmount] = useState(
    mode.kind === "occurrence" ? String(mode.current ?? mode.item.amount) : ""
  );
  const [picking, setPicking] = useState<null | "date" | "start" | "end">(null);
  const [confirmedOrphans, setConfirmedOrphans] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setConfirmedOrphans(false);
  };

  // ---- Occurrence scope: one field, and nothing else is editable -------
  if (mode.kind === "occurrence") {
    const err = overrideError(occAmount);
    return (
      <Sheet onClose={onClose}>
        <Text style={styles.title}>{mode.item.name} on {prettyDate(mode.date)}</Text>
        <Text style={styles.dim}>
          Only this date. Every other date keeps the rule&apos;s {money(mode.item.amount)}.
        </Text>
        <Field label="Amount">
          <TextInput
            style={styles.field} keyboardType="decimal-pad" placeholder="0.00"
            placeholderTextColor={T.faint} value={occAmount} onChangeText={setOccAmount}
            autoFocus accessibilityLabel="Amount on this date"
          />
        </Field>
        <Actions
          busy={busy} disabled={!!err} error={err} cta="Save this date"
          onClose={onClose} onSubmit={() => onSaveOccurrence(occAmount)}
        />
      </Sheet>
    );
  }

  // ---- Rule scope, and adding -------------------------------------------
  const err = draftError(draft);
  const orphans = err ? 0 : orphanCount(draft);
  const blocked = orphans > 0 && !confirmedOrphans;
  const cats = [...(state.trackerCategories ?? [])].sort((a, b) => a.order - b.order);
  const showVariable = draft.recurring && canTrackActuals(state, draft.category);

  return (
    <Sheet onClose={onClose}>
      <Text style={styles.title}>{existing ? `Edit ${existing.name}` : "Add transaction"}</Text>
      {existing && draft.recurring ? (
        <Text style={styles.dim}>Changes every date this rule generates.</Text>
      ) : null}

      <Field label="Name">
        <TextInput
          style={styles.field} value={draft.name} onChangeText={(v) => set("name", v)}
          placeholder="Rent, paycheck, electric…" placeholderTextColor={T.faint}
          autoFocus={!existing} accessibilityLabel="Name"
        />
      </Field>

      <Field label="Amount">
        <TextInput
          style={styles.field} keyboardType="decimal-pad" placeholder="0.00"
          placeholderTextColor={T.faint} value={draft.amount}
          onChangeText={(v) => set("amount", v)} accessibilityLabel="Amount"
        />
      </Field>

      <Field label="Category">
        <View style={styles.chips}>
          {[["income", "Income"], ["bill", "Fixed bill"], ["oneoff", "One-off"]].map(([id, label]) => (
            <Chip key={id} on={draft.category === id} label={label} onPress={() => set("category", id)} />
          ))}
          {cats.map((c) => (
            <Chip key={c.id} on={draft.category === c.id} label={c.name} onPress={() => set("category", c.id)} />
          ))}
        </View>
      </Field>

      <Field label="Repeats">
        <View style={styles.chips}>
          <Chip on={!draft.recurring} label="Just once" onPress={() => set("recurring", false)} />
          {CADENCES.map((c) => (
            <Chip
              key={c} on={draft.recurring && draft.cadence === c} label={CADENCE_LABEL[c]}
              onPress={() => setDraft((d) => ({ ...d, recurring: true, cadence: c }))}
            />
          ))}
        </View>
      </Field>

      {!draft.recurring ? (
        <Field label="Date">
          <DateField value={draft.date} onPress={() => setPicking("date")} />
        </Field>
      ) : (
        <>
          <Field label="Starts">
            <DateField value={draft.startDate} onPress={() => setPicking("start")} />
          </Field>
          <Field label="Ends (optional)">
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <DateField value={draft.endDate || "No end date"} onPress={() => setPicking("end")} />
              </View>
              {draft.endDate ? (
                <Pressable style={styles.clear} onPress={() => set("endDate", "")} accessibilityRole="button">
                  <Text style={styles.clearText}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
          </Field>
        </>
      )}

      {showVariable && (
        <Pressable
          style={styles.check}
          onPress={() => set("variable", !draft.variable)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: draft.variable }}
        >
          <View style={[styles.box, draft.variable && styles.boxOn]}>
            {draft.variable ? <Text style={styles.tick}>✓</Text> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.checkLabel}>Track actual vs. budgeted</Text>
            <Text style={styles.rowSub}>For bills that move — log what it really cost each month.</Text>
          </View>
        </Pressable>
      )}

      {picking && (
        <DateTimePicker
          value={new Date((picking === "date" ? draft.date : picking === "start" ? draft.startDate : draft.endDate || draft.startDate) + "T00:00:00")}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          themeVariant="dark"
          onChange={(_e, d) => {
            setPicking(Platform.OS === "ios" ? picking : null);
            if (!d) return;
            const iso = d.toISOString().slice(0, 10) as ISODate;
            if (picking === "date") set("date", iso);
            else if (picking === "start") set("startDate", iso);
            else set("endDate", iso);
          }}
        />
      )}
      {picking && Platform.OS === "ios" && (
        <Pressable style={styles.doneDate} onPress={() => setPicking(null)} accessibilityRole="button">
          <Text style={styles.clearText}>Done</Text>
        </Pressable>
      )}

      {/* Moving a rule's day leaves date-specific amounts behind — an
          override belongs to a DATE and is never remapped onto a new one.
          Said before the save, with the count, never after. */}
      {orphans > 0 && (
        <Text style={styles.warn}>
          {orphans} date{orphans === 1 ? "" : "s"} with {orphans === 1 ? "its" : "their"} own amount
          won&apos;t line up with the new schedule and will go back to the rule&apos;s amount. Moving the
          rule back restores {orphans === 1 ? "it" : "them"}.
        </Text>
      )}

      <Actions
        busy={busy}
        disabled={!!err}
        error={err}
        cta={blocked ? "Save anyway" : existing ? "Save" : "Add"}
        onClose={onClose}
        onSubmit={() => {
          if (blocked) { setConfirmedOrphans(true); return; }
          onSaveDraft(draft);
        }}
      />
    </Sheet>
  );
}

// ---- pieces -------------------------------------------------------------

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.scrim}>
      <Pressable style={styles.scrimTap} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.card}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.cardInner}>
          {children}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View>
    <Text style={styles.label}>{label}</Text>
    {children}
  </View>
);

const DateField = ({ value, onPress }: { value: string; onPress: () => void }) => (
  <Pressable style={styles.field} onPress={onPress} accessibilityRole="button">
    <Text style={{ color: value.startsWith("No ") ? T.faint : T.text, fontSize: 16 }}>{value}</Text>
  </Pressable>
);

const Chip = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
  <Pressable
    style={[styles.chip, on && styles.chipOn]} onPress={onPress}
    accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={label}
  >
    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
  </Pressable>
);

function Actions({
  busy, disabled, error, cta, onClose, onSubmit,
}: {
  busy: boolean; disabled: boolean; error: string | null; cta: string;
  onClose: () => void; onSubmit: () => void;
}) {
  return (
    <>
      {/* The reason, not just a dead button. A disabled control with no
          explanation is the same bug as a silently dropped field. */}
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <View style={styles.row}>
        <Pressable style={[styles.btn, styles.ghost]} onPress={onClose} disabled={busy} accessibilityRole="button">
          <Text style={styles.ghostText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.primary, (disabled || busy) && styles.disabled]}
          disabled={disabled || busy}
          onPress={onSubmit}
          accessibilityRole="button"
          accessibilityLabel={cta}
        >
          {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.primaryText}>{cta}</Text>}
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  scrimTap: { flex: 1 },
  card: { maxHeight: "88%", backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: T.border },
  cardInner: { padding: 20, paddingBottom: 34, gap: 8 },
  title: { color: T.text, fontSize: 17, fontWeight: "700" },
  dim: { color: T.faint, fontSize: 12, lineHeight: 17, marginBottom: 2 },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8, marginBottom: 4 },
  field: { backgroundColor: T.bg, borderColor: T.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: T.text, fontSize: 16, minHeight: 48, justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { borderWidth: 1, borderColor: T.border, backgroundColor: T.bg, borderRadius: 999, paddingHorizontal: 13, minHeight: 38, justifyContent: "center" },
  chipOn: { backgroundColor: T.text, borderColor: T.text },
  chipText: { color: T.dim, fontSize: 13 },
  chipTextOn: { color: T.bg, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, marginTop: 14, alignItems: "center" },
  rowSub: { color: T.faint, fontSize: 12, marginTop: 2 },
  clear: { paddingHorizontal: 12, minHeight: 48, justifyContent: "center" },
  clearText: { color: T.brass, fontSize: 14 },
  doneDate: { alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 8 },
  check: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 14, minHeight: 44 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: T.faint, alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: T.brass, borderColor: T.brass },
  tick: { color: "#111827", fontSize: 14, fontWeight: "900", lineHeight: 16 },
  checkLabel: { color: T.text, fontSize: 15 },
  warn: { color: T.dim, fontSize: 12, lineHeight: 17, marginTop: 12 },
  err: { color: T.expense, fontSize: 13, marginTop: 12 },
  btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: T.border },
  ghostText: { color: T.dim, fontSize: 15 },
  primary: { backgroundColor: T.brass },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
