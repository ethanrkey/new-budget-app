import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import DatePicker from "./DatePicker";
import { T, money } from "../lib/theme";
import { FIELD_TEXT } from "../lib/fields";
import { categoryOnModeChange } from "../../src/shared/entryDefaults.ts";
import { CADENCES } from "../../src/engine/model.ts";
import { blankDraft, draftOf, draftError, overrideError, canTrackActuals, draftTouched, type Draft } from "../lib/edit";
import type { BudgetItem, BudgetState, ISODate, Cadence } from "../../src/engine/types.ts";
import { fmtDate } from "../../src/shared/dates.ts";
import { OCCURRENCE_EDIT } from "../../src/content/transaction.ts";

// The editor. It has NO SCOPE CONTROL, which is the point of asking first:
// in occurrence mode it shows one field, because one field is all that
// scope can change, and in rule mode it shows the rule.
//
// Modelled on LogBalance, which is the write surface this app already had
// — same bottom sheet, same field styling, same disabled-while-saving
// behavior, so the second thing you can write looks like the first.
//
// CONTENT ONLY: the Modal belongs to BottomSheet. This sheet is reached by
// swapping the body of a sheet that is already presented, never by
// presenting a second one — see BottomSheet for why that distinction cost
// a shipped bug.
const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", yearly: "Yearly",
};

export type SheetMode =
  /** `presetCategory`: opened FOR something — see blankDraft in lib/edit. */
  | { kind: "add"; presetCategory?: string }
  | { kind: "rule"; item: BudgetItem }
  | { kind: "occurrence"; item: BudgetItem; date: ISODate; current: number | null };

export default function TransactionSheet({
  mode, state, busy, orphanCount, onSaveDraft, onSaveOccurrence, onClose, onDirtyChange,
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
  /**
   * Has anything been typed? Reported UPWARD because the host owns
   * every way out of this sheet — Cancel is in here, but the scrim,
   * the hardware back button and the swipe are the host's, and a
   * "Discard changes?" that only guards one of the four is not a
   * guard. See the Ledger screen's closeSheet.
   */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const existing = mode.kind === "add" ? null : mode.item;
  // What the form arrived holding, built ONCE and used both as the
  // starting value and as the thing "has anything been typed?" is
  // measured against. Two calls to blankDraft() would agree today and
  // disagree across midnight, which is the kind of bug that is only
  // ever seen by somebody filling in a form at midnight.
  const preset = mode.kind === "add" ? mode.presetCategory ?? null : null;
  const initial = useRef({
    draft: existing ? draftOf(existing) : blankDraft(undefined, preset),
    occAmount: mode.kind === "occurrence" ? String(mode.current ?? mode.item.amount) : "",
  });
  const [draft, setDraft] = useState<Draft>(initial.current.draft);
  const [occAmount, setOccAmount] = useState(initial.current.occAmount);
  const [picking, setPicking] = useState<null | "date" | "start" | "end">(null);
  // HAS SAVE BEEN PRESSED? Nothing is wrong with a form nobody has
  // filled in yet — it is empty, which is what empty looks like. This
  // sheet greeted "Add income" from the Ledger guide with a red "Give
  // it a name." before a single key was pressed, which reads as the
  // app refusing something that was never asked for. The error waits
  // for the attempt now, like CategorySheet's always has.
  const [tried, setTried] = useState(false);

  const dirty = mode.kind === "occurrence"
    ? occAmount !== initial.current.occAmount
    : draftTouched(draft, initial.current.draft);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // THE CATEGORY FOLLOWS THE REPEATS CHIPS UNTIL THE USER DISAGREES.
  // "Just once" means One-off and a cadence means Fixed bill, which
  // is what the chips already say in words — but only while nobody
  // has picked a category themselves. A default that keeps
  // reasserting itself is an argument, not a default. The rule is
  // shared with the web's two forms: src/shared/entryDefaults.ts.
  const [categoryTouched, setCategoryTouched] = useState(false);
  const pickCategory = (id: string) => { setCategoryTouched(true); set("category", id); };
  const setRepeats = (recurring: boolean, cadence?: Draft["cadence"]) =>
    setDraft((d) => ({
      ...d,
      recurring,
      ...(cadence ? { cadence } : {}),
      // A PRESET OUTRANKS THE CHIPS. Picking a cadence on a form
      // opened as "Add income" must not quietly turn it into a fixed
      // bill — the caller already answered this question. Same rule,
      // same argument, same file as the web's "+ Add a loan".
      category: categoryOnModeChange(
        recurring ? "recurring" : "oneoff", d.category,
        { touched: categoryTouched, presetCategory: preset },
      ),
    }));

  // ---- Occurrence scope: one field, and nothing else is editable -------
  if (mode.kind === "occurrence") {
    const err = overrideError(occAmount);
    return (
      <Sheet onClose={onClose}>
        <Text style={styles.title}>{mode.item.name} on {fmtDate(mode.date)}</Text>
        <Text style={styles.dim}>{OCCURRENCE_EDIT.only}</Text>
        <Text style={styles.dim}>{OCCURRENCE_EDIT.current(money(mode.item.amount))}</Text>
        <Field label="Amount">
          <TextInput
            style={styles.field} keyboardType="decimal-pad" placeholder="0.00"
            placeholderTextColor={T.faint} value={occAmount} onChangeText={setOccAmount}
            autoFocus accessibilityLabel="Amount on this date"
          />
        </Field>
        <Actions
          busy={busy} error={tried ? err : null} cta="Save this date"
          onClose={onClose}
          onSubmit={() => { setTried(true); if (!err) onSaveOccurrence(occAmount); }}
        />
      </Sheet>
    );
  }

  // ---- Rule scope, and adding -------------------------------------------
  const err = draftError(draft);
  const orphans = err ? 0 : orphanCount(draft);
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
            <Chip key={id} on={draft.category === id} label={label} onPress={() => pickCategory(id!)} />
          ))}
          {cats.map((c) => (
            <Chip key={c.id} on={draft.category === c.id} label={c.name} onPress={() => pickCategory(c.id)} />
          ))}
        </View>
      </Field>

      <Field label="Repeats">
        <View style={styles.chips}>
          <Chip on={!draft.recurring} label="Just once" onPress={() => setRepeats(false)} />
          {CADENCES.map((c) => (
            <Chip
              key={c} on={draft.recurring && draft.cadence === c} label={CADENCE_LABEL[c]}
              onPress={() => setRepeats(true, c)}
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
        <DatePicker
          value={picking === "date" ? draft.date : picking === "start" ? draft.startDate : draft.endDate || draft.startDate}
          onPick={(iso) => {
            if (picking === "date") set("date", iso as ISODate);
            else if (picking === "start") set("startDate", iso as ISODate);
            else set("endDate", iso);
          }}
          onClose={() => setPicking(null)}
        />
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
        error={tried ? err : null}
        // ONE PRESS. The web needs two — "Save", then "Save anyway" — because
        // it only learns the orphan count when you submit. This sheet counts
        // them live and shows the warning beside the button, so the warning
        // has already been read by the time the button is pressed; a second
        // press would be ceremony, and the label flipping from "Save anyway"
        // back to "Save" between them reads as a bug.
        cta={orphans > 0 ? "Save anyway" : existing ? "Save" : "Add"}
        onClose={onClose}
        onSubmit={() => { setTried(true); if (!err) onSaveDraft(draft); }}
      />
    </Sheet>
  );
}

// ---- pieces -------------------------------------------------------------

// THE PAGE SHEET IS THE CARD, since build 9.
//
// This used to draw one: `maxHeight: "88%"`, rounded top corners and a
// hairline, sitting at the bottom of a transparent modal's scrim. The
// form is hosted in a real iOS page sheet now (NativeSheet), and UIKit
// draws the card — its corners, its inset from the top, its dimming
// and its drag. Keeping a second card inside it would be a card in a
// card, and the percentage height had nothing left to be a percentage
// OF.
//
// So this is just the scroller, filling the sheet it is in. `flex: 1`
// rather than a height: a ScrollView in a box with no definite height
// collapses, which is the oldest trap in React Native.
function Sheet({ children }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <ScrollView
      style={styles.card}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.cardInner}
    >
      {children}
    </ScrollView>
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
    {/* fmtDate leaves a non-date alone, which is what makes the
        "No end date" placeholder work through the same path. */}
    <Text style={{ color: value.startsWith("No ") ? T.faint : T.text, fontSize: 16 }}>{fmtDate(value)}</Text>
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

// VALIDATE ON PRESS RATHER THAN DISABLING THE BUTTON — the same
// decision CategorySheet records, now that both forms make it. The
// button always responds and says what is wrong; a dead button with no
// explanation is the thing people tap twice and then give up on, and a
// red error over a form nobody has typed in yet is worse again.
function Actions({
  busy, error, cta, onClose, onSubmit,
}: {
  busy: boolean; error: string | null; cta: string;
  onClose: () => void; onSubmit: () => void;
}) {
  return (
    <>
      {/* The reason, once there is one to give. */}
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <View style={styles.row}>
        <Pressable style={[styles.btn, styles.ghost]} onPress={onClose} disabled={busy} accessibilityRole="button">
          <Text style={styles.ghostText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.primary, busy && styles.disabled]}
          disabled={busy}
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
  card: { flex: 1, backgroundColor: T.surface },
  // The top padding is bigger than it was, because the sheet no longer
  // carries a 24pt grabber strip above the content — UIKit's own
  // grabber lives in the sheet's chrome.
  cardInner: { padding: 20, paddingTop: 24, paddingBottom: 34, gap: 8 },
  title: { color: T.text, fontSize: 17, fontWeight: "700" },
  dim: { color: T.faint, fontSize: 12, lineHeight: 17, marginBottom: 2 },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8, marginBottom: 4 },
  field: { ...FIELD_TEXT, backgroundColor: T.bg, borderColor: T.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: T.text, fontSize: 16, minHeight: 48, justifyContent: "center" },
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
