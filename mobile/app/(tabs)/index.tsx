import { useMemo, useState } from "react";
import {
  Platform, Pressable, RefreshControl, SectionList, StyleSheet, Text, View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useBudget } from "../../components/StateProvider";
import SpendingMix from "../../components/SpendingMix";
import CalendarView from "../../components/CalendarView";
import BottomSheet from "../../components/BottomSheet";
import ScopeSheet from "../../components/ScopeSheet";
import TransactionSheet, { type SheetMode } from "../../components/TransactionSheet";
import { T, money } from "../../lib/theme";
import { computeLedger, groupByMonth, computeSpendingByCategory } from "../../../src/engine/compute.ts";
import { ledgerHorizonOf } from "../../../src/engine/model.ts";
import {
  rowTarget, overrideAt, scopeActions, orphansIfSaved,
  saveItem, saveOccurrence, resetOccurrence, removeItem,
  type Draft, type ScopeAction,
} from "../../lib/edit";
import type { BudgetItem } from "../../../src/engine/types.ts";

const prettyDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function LedgerScreen() {
  const { state, refresh, refreshing, commit, online, saving } = useBudget();
  const [horizon, setHorizon] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [calendar, setCalendar] = useState(false);
  // Which row was tapped, as its LEDGER ROW ID ("<itemId>@<date>") — the
  // date half is what makes "just this date" possible, so it is carried
  // whole and only split by the named helpers in lib/edit.
  const [scopeFor, setScopeFor] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetMode | null>(null);

  const effective = horizon ?? ledgerHorizonOf(state!);
  // ONE resolution of the tapped row, used for the heading, the button
  // labels AND the mutation — so a sheet can never name one item and act
  // on another. See rowTarget.
  const target = scopeFor ? rowTarget(state!, scopeFor) : null;

  async function onScopePick(a: ScopeAction) {
    const item = target?.item;
    if (!item) { setScopeFor(null); return; }

    // EDIT: swap the body of the sheet that is already up. `setSheet`
    // before `setScopeFor(null)` is not load-bearing — they land in one
    // commit and the host stays visible throughout — but the host's
    // `visible` must never pass through false, which is what ordering
    // them this way makes obvious to the next reader.
    if (a.kind === "edit-occurrence") {
      setSheet({ kind: "occurrence", item, date: a.date, current: overrideAt(state!, item.id, a.date) });
      setScopeFor(null);
      return;
    }
    if (a.kind === "edit-rule") {
      setSheet({ kind: "rule", item });
      setScopeFor(null);
      return;
    }

    // RESET and DELETE write immediately, and the sheet stays up until
    // the write lands. Closing first would dismiss this modal while the
    // failure modal was presenting — the same race, one layer along, and
    // a conflict comes back fast enough to hit it.
    const ok = a.kind === "reset-occurrence"
      ? await commit(resetOccurrence(item.id, a.date), `${item.name} on ${prettyDate(a.date)} reset to the rule`)
      : await commit(removeItem(item.id), `${item.name} deleted`);
    if (ok) setScopeFor(null);
  }

  async function submitDraft(d: Draft) {
    const existing = sheet && sheet.kind !== "add" ? sheet.item : null;
    const ok = await commit(saveItem(d, existing), `${d.name.trim() || "Transaction"}${existing ? "" : " added"}`);
    if (ok) setSheet(null);
  }

  async function submitOccurrence(amount: string) {
    if (!sheet || sheet.kind !== "occurrence") return;
    const { item, date } = sheet;
    const ok = await commit(saveOccurrence(item.id, date, amount), `${item.name} on ${prettyDate(date)}`);
    if (ok) setSheet(null);
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
        <Pressable style={styles.chip} onPress={() => setPicking(true)}>
          <Text style={styles.chipText}>through {effective}</Text>
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
      {/* The running balance is LIST-ONLY, same as the web: a month grid
          has nowhere honest to put it, and faking one would have the cell
          and the balance telling different stories. */}
      {!calendar && (
        <View style={styles.endingWrap}>
          <Text style={styles.label}>Ending balance</Text>
          <Text style={[styles.ending, ending < 0 && { color: T.expense }]}>{money(ending)}</Text>
        </View>
      )}
      <SpendingMix mix={mix} />
    </>
  );

  return (
    <View style={styles.wrap}>
      {picking && (
        <DateTimePicker
          value={new Date(effective + "T00:00:00")}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          themeVariant="dark"
          onChange={(_e, d) => {
            setPicking(Platform.OS === "ios");
            if (d) setHorizon(d.toISOString().slice(0, 10));
          }}
        />
      )}

      {calendar ? (
        <SectionList
          sections={[{ title: "", data: [0] }]}
          keyExtractor={() => "cal"}
          ListHeaderComponent={toolbar}
          renderSectionHeader={() => null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={T.brass} />}
          renderItem={() => <CalendarView rows={rows} categories={state!.trackerCategories} />}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(r) => r.id}
          stickySectionHeadersEnabled
          ListHeaderComponent={toolbar}
          contentContainerStyle={styles.listPad}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={T.brass} />}
          renderSectionHeader={({ section }) => <Text style={styles.month}>{section.title}</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              disabled={!online}
              onPress={() => setScopeFor(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${prettyDate(item.date)}, ${money(item.amount)}`}
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
          ListEmptyComponent={<Text style={styles.empty}>Nothing projected in this window.</Text>}
        />
      )}

      {/* ONE sheet. Choosing a scope swaps what is inside it; it never
          dismisses one modal to present another, which is the thing iOS
          swallows. See components/BottomSheet.tsx. */}
      <BottomSheet
        visible={!!sheet || !!target}
        onClose={() => { setSheet(null); setScopeFor(null); }}
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
            onClose={() => setSheet(null)}
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
  endingWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  ending: { color: T.text, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
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
