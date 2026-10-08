import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBudget } from "../../components/StateProvider";
import { T, money } from "../../lib/theme";
import { computeBudget } from "../../../src/engine/compute.ts";
import { BUDGET_SECTIONS, computeBudgetLayout } from "../../../src/engine/budgetLayout.ts";
import { roleOfCategory, isRetainedOutflow } from "../../../src/engine/palette.ts";
import BottomSheet from "../../components/BottomSheet";
import TransactionSheet, { type SheetMode } from "../../components/TransactionSheet";
import { saveItem, orphansIfSaved, type Draft } from "../../lib/edit";
import { ledgerHorizonOf } from "../../../src/engine/model.ts";
import type { BudgetColumn } from "../../../src/engine/types.ts";

// THE PINNED COLUMN, the RN way.
//
// RN has no position:sticky, so the web's one-table-with-a-sticky-cell is
// not portable. The idiom here is PARALLEL COLUMNS: an outer vertical
// scroller holds a row containing (a) the fixed label column and (b) a
// horizontal scroller of month columns. Only the right side scrolls
// sideways; the label column simply never moves because it is outside that
// scroller. No scroll syncing, no listeners, no jitter.
//
// The cost, and it is the whole trick: both halves must agree on row
// height, so ROW_H is a constant and every cell is exactly that tall. The
// web got this free from table layout. Get it wrong and the labels drift
// out of line with their numbers — which is why the heights live in one
// place and not in two stylesheets.
const ROW_H = 34;
const SECTION_H = 28;
const LABEL_W = 150;
const COL_W = 108;

type Cell = {
  key: string; label: string; values: (c: BudgetColumn) => number;
  tone?: string; head?: boolean; bold?: boolean;
  /** The item this row stands for, when there is exactly one. Totals and
   *  section summaries have none and stay inert. */
  itemName?: string;
};

export default function BudgetScreen() {
  const { state, refresh, refreshing, commit, online, saving } = useBudget();
  const [sheet, setSheet] = useState<SheetMode | null>(null);

  // Tapping a row name opens that item's editor, same as the web. A budget
  // row is a NAME, not an occurrence, so there is no date to scope to and
  // no scope sheet — it edits the rule, which is the only thing the row
  // stands for.
  const openItem = (name: string) => {
    const item = state!.recurring.find((r) => r.name === name)
      ?? state!.oneoffs.find((o) => o.name === name);
    if (item) setSheet({ kind: "rule", item });
  };

  async function submitDraft(d: Draft) {
    const existing = sheet && sheet.kind !== "add" ? sheet.item : null;
    const ok = await commit(saveItem(d, existing), d.name.trim() || "Transaction");
    if (ok) setSheet(null);
  }

  const { columns, rows } = useMemo(() => {
    const columns = computeBudget(state!, state!.settings.budgetHorizon);
    const layout = computeBudgetLayout(columns, state!.trackerCategories);
    const cats = state!.trackerCategories;
    const out: (Cell | { section: string })[] = [];

    out.push({ section: "INCOME" });
    out.push({ key: "start", label: "Starting point", values: (c) => c.startingPoint });
    out.push({ key: "take", label: "Take-home", values: (c) => c.takeHome, tone: T.income });
    out.push({ key: "checking", label: "Checking", values: (c) => c.tdChecking, tone: T.income });
    for (const n of layout.otherIncomeNames) {
      out.push({ key: `oi-${n}`, label: n, values: (c) => c.otherInItems[n]?.val ?? 0, tone: T.income });
    }
    out.push({ key: "totalIn", label: "TOTAL IN", values: (c) => c.totalIn, tone: T.income, bold: true });

    for (const sec of BUDGET_SECTIONS) {
      const names = sec.key === "saving" ? layout.savingGroups.flat() : layout.sectionItems[sec.key];
      if (names.length === 0) continue;
      out.push({ section: sec.label });
      for (const n of names) {
        const catId = layout.nameCat[n];
        // Red is money GONE. A transfer to savings, a contribution or a
        // loan payment leaves the account without being spent, so it
        // prints plain — the same rule the web uses, from the same engine
        // function so the two cannot drift.
        const retained = isRetainedOutflow(roleOfCategory(catId, cats));
        out.push({
          key: `e-${n}`, label: n, itemName: n,
          values: (c) => Math.abs(c.expenseItems[n]?.val ?? 0),
          ...(retained ? {} : { tone: T.expense }),
        });
      }
    }
    out.push({ key: "totalOut", label: "TOTAL OUT", values: (c) => c.totalOut, tone: T.expense, bold: true });
    out.push({ key: "net", label: "MONTHLY NET", values: (c) => c.net, bold: true });
    out.push({ key: "cum", label: "CUMULATIVE NET", values: (c) => c.cumulative, bold: true, head: true });

    return { columns, rows: out };
  }, [state]);

  return (
    <>
    <ScrollView
      style={styles.wrap}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={T.brass} />}
    >
      <View style={styles.sheet}>
        {/* (a) the pinned column */}
        <View style={{ width: LABEL_W }}>
          <View style={[styles.cell, styles.headCell, { width: LABEL_W, alignItems: "flex-start" }]}>
            <Text style={styles.headText}>MONTH</Text>
          </View>
          {rows.map((r, i) =>
            "section" in r ? (
              <View key={`s${i}`} style={[styles.section, { width: LABEL_W }]}>
                <Text style={styles.sectionText}>{r.section}</Text>
              </View>
            ) : (
              <Pressable
                key={r.key}
                style={({ pressed }) => [
                  styles.cell, { width: LABEL_W, alignItems: "flex-start" },
                  r.head && styles.cumRow, pressed && r.itemName && styles.rowPressed,
                ]}
                disabled={!r.itemName || !online}
                onPress={() => r.itemName && openItem(r.itemName)}
                accessibilityRole={r.itemName ? "button" : undefined}
                accessibilityLabel={r.itemName ? `Edit ${r.itemName}` : undefined}
              >
                <Text
                  style={[styles.labelText, r.bold && styles.boldText, r.itemName && online && styles.tappable]}
                  numberOfLines={1}
                >
                  {r.label}
                </Text>
              </Pressable>
            )
          )}
        </View>

        {/* (b) the months, the only thing that scrolls sideways */}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.monthsPad}>
          <View style={{ flexDirection: "row" }}>
            {columns.map((c) => (
              <View key={c.key} style={{ width: COL_W }}>
                <View style={[styles.cell, styles.headCell, { width: COL_W }]}>
                  <Text style={styles.headText}>{c.label}</Text>
                </View>
                {rows.map((r, i) =>
                  "section" in r ? (
                    <View key={`s${i}`} style={[styles.section, { width: COL_W }]} />
                  ) : (
                    <View key={r.key} style={[styles.cell, { width: COL_W }, r.head && styles.cumRow]}>
                      <Text
                        style={[
                          styles.num,
                          r.tone ? { color: r.tone } : null,
                          r.bold && styles.boldText,
                          // The monthly net earns a color in BOTH
                          // directions, same as the web: a positive month
                          // is the answer the row exists to give, and
                          // leaving it plain undersold it.
                          r.key === "net" && { color: r.values(c) < 0 ? T.expense : T.income },
                          r.key === "cum" && r.values(c) < 0 && { color: T.expense },
                        ]}
                        numberOfLines={1}
                      >
                        {r.values(c) === 0 && !r.bold ? "" : money(r.values(c))}
                      </Text>
                    </View>
                  )
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
      <Text style={styles.foot}>Swipe the months sideways. The row names stay put.</Text>
    </ScrollView>
      {/* One host, one modal — see components/BottomSheet.tsx. */}
      <BottomSheet visible={!!sheet} onClose={() => setSheet(null)}>
        {sheet && (
          <TransactionSheet
            mode={sheet}
            state={state!}
            busy={saving}
            orphanCount={(d) =>
              orphansIfSaved(state!, d, sheet.kind === "add" ? null : sheet.item, ledgerHorizonOf(state!)).length}
            onSaveDraft={submitDraft}
            onSaveOccurrence={() => {}}
            onClose={() => setSheet(null)}
          />
        )}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  sheet: { flexDirection: "row", paddingLeft: 12 },
  monthsPad: { paddingRight: 12 },
  cell: {
    height: ROW_H, justifyContent: "center", alignItems: "flex-end", paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border,
  },
  headCell: { borderBottomWidth: 1, borderBottomColor: T.surfaceAlt },
  headText: { color: T.faint, fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  section: { height: SECTION_H, justifyContent: "center", backgroundColor: T.surface },
  sectionText: { color: T.brass, fontSize: 9, fontWeight: "700", letterSpacing: 0.7, paddingHorizontal: 8 },
  labelText: { color: T.text, fontSize: 12 },
  // A tappable row says so: the same dotted underline the web uses on an
  // editable row name, so the affordance is not a thing you discover.
  tappable: { textDecorationLine: "underline", textDecorationStyle: "dotted", textDecorationColor: T.faint },
  rowPressed: { backgroundColor: T.surfaceAlt },
  boldText: { fontWeight: "700" },
  num: { color: T.dim, fontSize: 12, fontVariant: ["tabular-nums"] },
  cumRow: { backgroundColor: T.surfaceAlt },
  foot: { color: T.faint, fontSize: 11, textAlign: "center", paddingVertical: 14 },
});
