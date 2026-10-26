import { useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { CONNECT_HINT, CONNECT_HINT_DISMISS } from "../../src/content/connect.ts";
import { shouldOfferHint } from "../../src/shared/connect.ts";
import { useBudget } from "./StateProvider";
import { allowlistedNow } from "../lib/connection";
import FormSheet, { useDiscardGuard } from "./FormSheet";
import DatePicker from "./DatePicker";
import { T, money } from "../lib/theme";
import { FIELD_TEXT } from "../lib/fields";
import { todayISO } from "../../src/engine/model.ts";
import { HIDDEN_ROWS_COPY as HIDDEN, DISCARD_BALANCE, DATE_LABEL, WHY_NOT } from "../../src/content/logBalance.ts";
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
  title, currentLabel, cta, warn, busy, onSubmit, onClose, hiddenRows, onOpenSettings,
  dateLabel = DATE_LABEL.balance,
}: {
  title: string; currentLabel?: string; cta: string; warn?: boolean;
  busy: boolean; onSubmit: (amount: number, date: string) => void; onClose: () => void;
  /** What the date field is called. "As of" for a reading; "On" for a
   *  contribution, which is an event and not a statement about a
   *  moment. See DATE_LABEL. */
  dateLabel?: string;
  /** Rows that would drop off the Ledger if the anchor moved to this
   *  date. Only the checking balance passes it — a tracked account's
   *  reading does not move the forecast's starting point. */
  hiddenRows?: (date: string) => HiddenRow[];
  /**
   * Opens Settings, for the "want this automatic?" line.
   *
   * ONLY THE CHECKING BALANCE PASSES IT, which is also what gates
   * the line: this sheet has five call sites — a tracked account's
   * reading, a contribution, two edits — and a bank connection is
   * about checking. A prop nobody else hands in is a cleaner gate
   * than a flag everybody has to remember to leave false.
   */
  onOpenSettings?: () => void;
}) {
  const { state, commit } = useBudget();
  const offerHint = !!onOpenSettings && !!state
    && shouldOfferHint(state.settings, allowlistedNow());
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [picking, setPicking] = useState(false);
  // The rows about to disappear, once the user has pressed Confirm and
  // there turned out to be some. Null means "not asked yet".
  const [confirming, setConfirming] = useState<HiddenRow[] | null>(null);
  const parsed = amount.trim() === "" ? null : Number(amount);
  // WHY SAVE WOULD NOT WORK, rather than a button that stops
  // responding. Null means nothing is wrong, which is also the
  // permission to submit. Shown only once Save has been pressed —
  // a red line over a form nobody has typed in yet is worse than
  // the dead button it replaces.
  const why = WHY_NOT.balance(amount);
  const [said, setSaid] = useState<string | null>(null);
  // TYPED IS DIRTY, valid or not: "4." and "40o" are both somebody
  // part way through a number, and losing them to a stray swipe is
  // the same loss as losing a good one. The date is not dirtiness —
  // it opens on today and changing it alone leaves nothing to throw
  // away.
  // ONE EXPRESSION, used by both the guard and the gesture. It was
  // written out twice — once here and once as the sheet's `dirty`
  // prop — and a mutation that changed only this one survived,
  // because the OTHER copy was still right. Two predicates that have
  // to agree are one that will not.
  const dirty = amount.trim() !== "";
  const requestClose = useDiscardGuard(dirty, DISCARD_BALANCE, onClose);

  // A BACK-DATED LOG THAT HIDES NOTHING GETS NO PROMPT. The warning
  // earns its interruption by naming specific rows; shown when there
  // are none it is noise, and noise is how a warning stops being read.
  function submit() {
    if (why) { setSaid(why); return; }
    setSaid(null);
    const dropping = hiddenRows?.(date) ?? [];
    if (dropping.length > 0 && confirming == null) { setConfirming(dropping); return; }
    onSubmit(parsed!, date);
  }

  return (
    <FormSheet onRequestClose={requestClose} dirty={dirty}>
      <>
          {confirming ? (
            <>
              <Text style={styles.title}>{HIDDEN.title}</Text>
              <Text style={styles.dim}>{HIDDEN.lede(confirming.length, fmtDate(date))}</Text>
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
                {/* STRAIGHT OUT, no discard prompt. The person has
                    just read a warning naming the rows that would
                    disappear and chosen to leave — that IS the
                    confirmation, and asking again is the noise this
                    file's own header warns about. The SWIPE is still
                    guarded, because a swipe is accidental in a way a
                    button press is not. */}
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
          {/* LABELED, like the two buttons below it. A Text beside a
              TextInput is not a label to VoiceOver — it read this as
              an unlabeled text field, which is the same gap the
              buttons had and was found the same way. */}
          <TextInput
            style={styles.field}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={T.faint}
            value={amount}
            onChangeText={setAmount}
            accessibilityLabel="Amount"
            autoFocus
          />

          <Text style={styles.label}>{dateLabel}</Text>
          <Pressable
            style={styles.field}
            onPress={() => setPicking(true)}
            accessibilityRole="button"
            accessibilityLabel={`${dateLabel} ${fmtDate(date)}. Change the date.`}
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

          {said ? <Text style={styles.err}>{said}</Text> : null}

          <View style={styles.row}>
            {/* Both buttons carry a role and a label. They did not, so
                VoiceOver read the one that writes a balance as an
                unlabeled button — and a test could not find it either,
                which is how the gap surfaced. */}
            <Pressable
              style={[styles.btn, styles.ghost]} onPress={requestClose} disabled={busy}
              accessibilityRole="button" accessibilityLabel="Cancel"
            >
              <Text style={styles.ghostText}>Cancel</Text>
            </Pressable>
            <Pressable
              // DISABLED ONLY WHILE SAVING. That is a write in
              // flight, not a verdict on what has been typed.
              style={[styles.btn, styles.primary, busy && styles.disabled]}
              disabled={busy}
              onPress={submit}
              accessibilityRole="button" accessibilityLabel={cta}
            >
              {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.primaryText}>{cta}</Text>}
            </Pressable>
          </View>

          {/* THE ONE PLACE THIS IS EVER MENTIONED to someone who has
              not turned it on, and NOT IN SETUP, on the owner's call.
              The reason generalizes: somebody deciding whether to use
              this app at all is the wrong person to offer a bank
              connection to. This is read by somebody who has just
              typed a balance by hand and therefore knows exactly what
              the manual path costs them.

              IT LOADS NO PLAID CODE. It is a sentence, a link to
              Settings, and a way to never see it again. */}
          {offerHint && (
            <View style={styles.hint}>
              <Pressable
                onPress={onOpenSettings}
                accessibilityRole="link" accessibilityLabel={CONNECT_HINT}
              >
                <Text style={styles.hintText}>{CONNECT_HINT}</Text>
              </Pressable>
              <Pressable
                onPress={() => { void commit((st) => ({ ...st, settings: { ...st.settings, hideConnectHint: true } }), "Hint dismissed", "none"); }}
                accessibilityRole="button" accessibilityLabel={CONNECT_HINT_DISMISS}
                hitSlop={8}
              >
                <Text style={styles.hintDismiss}>{CONNECT_HINT_DISMISS}</Text>
              </Pressable>
            </View>
          )}
          </>
          )}
      </>
    </FormSheet>
  );
}

export const currently = (balance: number | null, asOf: string | null) =>
  balance == null ? undefined : `Currently ${money(balance)}, as of ${fmtDate(asOf)}`;

const styles = StyleSheet.create({
  // NO SCRIM AND NO CARD IN HERE. A page sheet is the card — see
  // FormSheet, which owns the padding this used to carry.
  title: { color: T.text, fontSize: 17, fontWeight: "700" },
  // QUIET, and below the buttons. It is an aside on a form somebody
  // opened to do something else; anything louder would be an ad.
  hint: { marginTop: 18, gap: 4 },
  hintText: { color: T.dim, fontSize: 13, lineHeight: 19 },
  hintDismiss: { color: T.faint, fontSize: 12 },
  dim: { color: T.faint, fontSize: 12, marginBottom: 4 },
  hiddenList: { maxHeight: 190, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: T.border },
  hiddenRow: { flexDirection: "row", alignItems: "baseline", gap: 10, paddingVertical: 6 },
  hiddenDate: { color: T.faint, fontSize: 12, width: 78, fontVariant: ["tabular-nums"] },
  hiddenName: { color: T.text, fontSize: 13, flex: 1 },
  hiddenAmount: { color: T.dim, fontSize: 13, fontVariant: ["tabular-nums"] },
  hiddenWhy: { color: T.dim, fontSize: 12, lineHeight: 17, marginTop: 12 },
  hiddenEscape: { color: T.brass, fontSize: 12, lineHeight: 17, marginTop: 8 },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8 },
  field: { ...FIELD_TEXT, backgroundColor: T.bg, borderColor: T.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: T.text, fontSize: 16, minHeight: 48, justifyContent: "center" },
  warn: { color: T.dim, fontSize: 12, lineHeight: 17, marginTop: 10 },
  err: { color: T.expense, fontSize: 13, marginTop: 12 },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: T.border },
  ghostText: { color: T.dim, fontSize: 15 },
  primary: { backgroundColor: T.brass },
  primaryText: { color: "#111827", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
