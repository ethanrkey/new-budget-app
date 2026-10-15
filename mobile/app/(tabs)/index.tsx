import { useMemo, useState } from "react";
import {
  Alert, Platform, Pressable, RefreshControl, SectionList, StyleSheet, Text, View,
} from "react-native";
import { useBudget } from "../../components/StateProvider";
import { useChrome } from "../../components/Chrome";
import SpendingMix from "../../components/SpendingMix";
import CalendarView from "../../components/CalendarView";
import BottomSheet from "../../components/BottomSheet";
import NativeSheet from "../../components/NativeSheet";
import DatePicker from "../../components/DatePicker";
import ScopeSheet from "../../components/ScopeSheet";
import TransactionSheet, { type SheetMode } from "../../components/TransactionSheet";
import FirstRun from "../../components/FirstRun";
import { T, money } from "../../lib/theme";
import { computeLedger, groupByMonth, computeSpendingByCategory } from "../../../src/engine/compute.ts";
import { ledgerHorizonOf } from "../../../src/engine/model.ts";
import { showFirstRun } from "../../lib/firstRun";
import * as feel from "../../lib/haptics";
import { DISCARD } from "../../../src/content/transaction.ts";
import {
  rowTarget, overrideAt, scopeActions, orphansIfSaved,
  saveItem, saveOccurrence, resetOccurrence, removeItem,
  type Draft, type ScopeAction,
} from "../../lib/edit";
import type { BudgetItem } from "../../../src/engine/types.ts";
import { fmtDate } from "../../../src/shared/dates.ts";


export default function LedgerScreen() {
  const { state, pullToRefresh, refreshing, commit, online, saving, prefs, setPref } = useBudget();
  // The checking log lives in Chrome now, because the control that
  // opens it (AnchorStrip) is on every tab. Step one of the guide
  // reaches the same modal rather than drawing a second one.
  const { logChecking } = useChrome();
  const [horizon, setHorizon] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [calendar, setCalendar] = useState(false);
  // Which row was tapped, as its LEDGER ROW ID ("<itemId>@<date>") — the
  // date half is what makes "just this date" possible, so it is carried
  // whole and only split by the named helpers in lib/edit.
  const [scopeFor, setScopeFor] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  // The editor the scope sheet asked for, waiting for the scope sheet
  // to be GONE. Two hosts means the original two-modal race is back on
  // this one transition — see BottomSheet and `onScopePick`.
  const [queued, setQueued] = useState<SheetMode | null>(null);
  // Whether the open transaction form has anything in it. Lives HERE
  // rather than in the sheet because the host owns every way out of
  // it — the scrim, the hardware back button and the swipe are all
  // this screen's, and a "Discard changes?" that guards only the
  // Cancel button is not a guard.
  const [dirty, setDirty] = useState(false);
  // The new-account guide. Shown until the three steps are done or it
  // is put away — NOT until the first write, which is the bug the first
  // version shipped with: logging a balance made the whole thing vanish
  // and left a new user on an empty Ledger with two steps to go and
  // nothing saying so.
  const guide = showFirstRun(state!, prefs.firstRunDismissed);

  // Defined here rather than inline so the SectionList header is a
  // stable element and the list does not remount it on every render.
  const FirstRunHeader = () => (
    <FirstRun
      state={state!}
      online={online}
      onLogBalance={logChecking}
      onAddIncome={() => setSheet({ kind: "add" })}
      onAddBill={() => setSheet({ kind: "add" })}
      onDismiss={() => setPref("firstRunDismissed", true)}
    />
  );

  const effective = horizon ?? ledgerHorizonOf(state!);
  // ONE resolution of the tapped row, used for the heading, the button
  // labels AND the mutation — so a sheet can never name one item and act
  // on another. See rowTarget.
  const target = scopeFor ? rowTarget(state!, scopeFor) : null;

  async function onScopePick(a: ScopeAction) {
    const item = target?.item;
    if (!item) { setScopeFor(null); return; }

    // EDIT: the form lives in a DIFFERENT host now — the system page
    // sheet — so this is the original bug's exact shape again: unmount
    // one modal and mount another in one commit, and iOS swallows the
    // second presentation because the first is still dismissing. So
    // the editor is QUEUED and opened from the scope sheet's
    // `onDismissed`, which is UIKit saying it has finished.
    if (a.kind === "edit-occurrence") {
      setQueued({ kind: "occurrence", item, date: a.date, current: overrideAt(state!, item.id, a.date) });
      setScopeFor(null);
      return;
    }
    if (a.kind === "edit-rule") {
      setQueued({ kind: "rule", item });
      setScopeFor(null);
      return;
    }

    // RESET and DELETE write immediately, and the sheet stays up until
    // the write lands. Closing first would dismiss this modal while the
    // failure modal was presenting — the same race, one layer along, and
    // a conflict comes back fast enough to hit it.
    const ok = a.kind === "reset-occurrence"
      ? await commit(resetOccurrence(item.id, a.date), `${item.name} on ${fmtDate(a.date)} reset to the rule`)
      : await commit(removeItem(item.id), `${item.name} deleted`);
    if (ok) setScopeFor(null);
  }

  /**
   * Every way out of the transaction form, and the only one.
   *
   * Cancel, the hardware back button, a tap on UIKit's dimmed area
   * and the downward swipe all arrive here, and anything typed is
   * confirmed before it is thrown away. Four doors is three extra
   * chances to lose a half-typed transaction, so there is one guard
   * rather than one per door.
   *
   * THE SWIPE IS GUARDED BEFORE IT HAPPENS, not after. `swipeToClose`
   * on the host is `!dirty`, which is UIKit's isModalInPresentation
   * inverted: a dirty sheet refuses the gesture itself, rubber-bands
   * back and reports the attempt here. So this is never asking about
   * a sheet that has already slid away and has to be put back.
   *
   * A clean form closes immediately. A confirm over an untouched
   * sheet is the kind of prompt people learn to dismiss without
   * reading, which is how the next one gets dismissed too.
   */
  function closeSheets() {
    const leave = () => {
      setSheet(null); setScopeFor(null); setPicking(false); setDirty(false); setQueued(null);
    };
    if (!sheet || !dirty) { leave(); return; }
    Alert.alert(DISCARD.title, DISCARD.body, [
      { text: DISCARD.keep, style: "cancel" },
      { text: DISCARD.discard, style: "destructive", onPress: leave },
    ]);
  }

  async function submitDraft(d: Draft) {
    const existing = sheet && sheet.kind !== "add" ? sheet.item : null;
    const ok = await commit(saveItem(d, existing), `${d.name.trim() || "Transaction"}${existing ? "" : " added"}`);
    // Saved is not dirty. Without this the next sheet opens carrying
    // the last one's answer to "has anything been typed?".
    if (ok) { setSheet(null); setDirty(false); }
  }

  async function submitOccurrence(amount: string) {
    if (!sheet || sheet.kind !== "occurrence") return;
    const { item, date } = sheet;
    const ok = await commit(saveOccurrence(item.id, date, amount), `${item.name} on ${fmtDate(date)}`);
    if (ok) { setSheet(null); setDirty(false); }
  }

  const { sections, rows, ending, mix } = useMemo(() => {
    const ledger = computeLedger(state!, effective);
    return {
      rows: ledger.rows,
      sections: groupByMonth(ledger.rows).map((g) => ({ title: g.label, data: g.rows })),
      ending: ledger.endingBalance,
      mix: computeSpendingByCategory(state!, effective),
    };
  }, [state, effective]);

  const toolbar = (
    <>
      <View style={styles.toolbar}>
        <View style={styles.seg}>
          {([["List", false], ["Calendar", true]] as const).map(([label, val]) => (
            <Pressable key={label} onPress={() => setCalendar(val)} style={[styles.segBtn, calendar === val && styles.segOn]}>
              <Text style={[styles.segText, calendar === val && styles.segTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={styles.chip}
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={`Project through ${fmtDate(effective)}. Change the date.`}
        >
          <Text style={styles.chipText}>through {fmtDate(effective)}</Text>
        </Pressable>
        {/* Offline is READ-ONLY by decision, so the control says so
            rather than failing after the tap. */}
        <Pressable
          style={[styles.add, !online && styles.addOff]}
          disabled={!online}
          onPress={() => setSheet({ kind: "add" })}
          accessibilityRole="button"
          accessibilityLabel={online ? "Add transaction" : "Offline"}
        >
          <Text style={styles.addText}>{online ? "+ Add" : "Offline"}</Text>
        </Pressable>
      </View>
      {/* THE INPUT IS THE HEADLINE, NOT THE OUTPUT — and as of
          2026-10-13 it is the headline on EVERY tab, not just this one.
          This screen used to draw its own copy of the verified balance
          because it was the only place that had one. Now AnchorStrip
          sits above all four tabs, which is what "match the web's
          hierarchy" actually meant: the web's AccountStrip has always
          been on every screen. Two presentations of one number, one of
          them bigger, would teach that they are two numbers. */}

      {/* The running balance is LIST-ONLY, same as the web: a month grid
          has nowhere honest to put it, and faking one would have the cell
          and the balance telling different stories. */}
      {!calendar && (
        <Text style={styles.endingLine}>
          Ending balance{" "}
          <Text style={[styles.endingValue, ending < 0 && { color: T.expense }]}>{money(ending)}</Text>
        </Text>
      )}
      <SpendingMix mix={mix} />
    </>
  );

  // The toolbar always; the guide under it while there are steps left.
  // Inside the list's header rather than above it, so a tall card
  // scrolls with the rows instead of pinning them into a sliver.
  const header = (
    <>
      {toolbar}
      {guide ? <FirstRunHeader /> : null}
    </>
  );

  return (
    <View style={styles.wrap}>
      {calendar ? (
        <SectionList
          sections={[{ title: "", data: [0] }]}
          keyExtractor={() => "cal"}
          ListHeaderComponent={header}
          renderSectionHeader={() => null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} tintColor={T.brass} />}
          renderItem={() => <CalendarView rows={rows} categories={state!.trackerCategories} />}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(r) => r.id}
          stickySectionHeadersEnabled
          ListHeaderComponent={header}
          contentContainerStyle={styles.listPad}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} tintColor={T.brass} />}
          renderSectionHeader={({ section }) => <Text style={styles.month}>{section.title}</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              disabled={!online}
              // Opening the scope sheet is a row committing to being
              // the one you meant. The sheet names it in words
              // immediately above the options, so the tap is confirmed
              // twice over and only one of them is a buzz.
              onPress={() => { feel.selection(); setScopeFor(item.id); }}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${fmtDate(item.date)}, ${money(item.amount)}`}
            >
              <Text style={styles.day}>{item.date.slice(8)}</Text>
              <View style={styles.name}>
                <Text style={styles.nameText} numberOfLines={1}>{item.name}</Text>
                {item.overridden && <Text style={styles.edited}>· edited</Text>}
              </View>
              <Text style={[styles.amt, { color: item.direction === "in" ? T.income : T.expense }]}>
                {item.direction === "in" ? "+" : "−"}{money(item.amount).replace("-", "")}
              </Text>
              <Text style={[styles.bal, item.negative && { color: T.expense }]}>{money(item.balance)}</Text>
            </Pressable>
          )}
          // With the guide up, "Nothing projected in this window." is
          // noise under a card that already explains the emptiness.
          ListEmptyComponent={guide ? null : <Text style={styles.empty}>Nothing projected in this window.</Text>}
        />
      )}

      {/* THE SMALL SURFACES: a list of scopes and a date wheel, both
          of which are a few rows tall and belong at the bottom of the
          screen rather than in a sheet that covers it. One host for
          both, so neither can present while the other dismisses.
          `onDismissed` is how the editor gets opened afterward — see
          onScopePick. */}
      <BottomSheet
        visible={!!target || picking}
        onClose={closeSheets}
        onDismissed={() => { if (queued) { setSheet(queued); setQueued(null); } }}
      >
        {picking ? (
          <DatePicker
            value={effective}
            onPick={setHorizon}
            onClose={() => setPicking(false)}
          />
        ) : target ? (
          <ScopeSheet
            name={target.name}
            actions={scopeActions(state!, scopeFor!, target.recurring)}
            onPick={(a) => { void onScopePick(a); }}
            onClose={() => setScopeFor(null)}
          />
        ) : null}
      </BottomSheet>

      {/* THE FORM, in the system's own page sheet: it takes most of
          the screen, so it should BE the screen's top layer rather
          than a card drawn at the bottom of a transparent one.
          `swipeToClose` is the guard, and it is UIKit's — a dirty
          form sets isModalInPresentation, so the gesture is refused
          and reported rather than performed and undone. See
          components/NativeSheet.tsx. */}
      <NativeSheet
        visible={!!sheet}
        onClose={closeSheets}
        swipeToClose={!dirty}
      >
        {sheet ? (
          <TransactionSheet
            mode={sheet}
            state={state!}
            busy={saving}
            orphanCount={(d) =>
              orphansIfSaved(state!, d, sheet.kind === "add" ? null : sheet.item, effective).length}
            onSaveDraft={submitDraft}
            onSaveOccurrence={submitOccurrence}
            onClose={closeSheets}
            onDirtyChange={setDirty}
          />
        ) : null}
      </NativeSheet>
    </View>
  );
}



const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  seg: { flexDirection: "row", backgroundColor: T.surface, borderRadius: 9, padding: 2, borderWidth: 1, borderColor: T.border },
  segBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 7, minHeight: 34, justifyContent: "center" },
  segOn: { backgroundColor: T.text },
  segText: { color: T.dim, fontSize: 13 },
  segTextOn: { color: T.bg, fontWeight: "700" },
  chip: { backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, minHeight: 34, justifyContent: "center" },
  chipText: { color: T.dim, fontSize: 12 },
  add: { backgroundColor: T.brass, borderRadius: 999, paddingHorizontal: 14, minHeight: 34, justifyContent: "center" },
  addOff: { backgroundColor: T.surfaceAlt },
  addText: { color: "#111827", fontSize: 13, fontWeight: "700" },
  rowPressed: { backgroundColor: T.surface },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  endingLine: { color: T.faint, fontSize: 12, paddingHorizontal: 16, paddingBottom: 10 },
  endingValue: { color: T.dim, fontVariant: ["tabular-nums"] },
  listPad: { paddingBottom: 28 },
  month: { backgroundColor: T.bg, color: T.brass, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 16, paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
  day: { color: T.faint, width: 22, fontVariant: ["tabular-nums"] },
  name: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  nameText: { color: T.text, fontSize: 15, flexShrink: 1 },
  edited: { color: T.faint, fontSize: 11 },
  amt: { fontSize: 15, fontVariant: ["tabular-nums"] },
  bal: { color: T.dim, fontSize: 13, width: 84, textAlign: "right", fontVariant: ["tabular-nums"] },
  empty: { color: T.faint, textAlign: "center", marginTop: 40 },
});
