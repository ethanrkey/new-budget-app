import { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBudget } from "../../components/StateProvider";
import { T, money } from "../../lib/theme";
import { computeBudget } from "../../../src/engine/compute.ts";
import { BUDGET_SECTIONS, computeBudgetLayout } from "../../../src/engine/budgetLayout.ts";
import { roleOfCategory, isRetainedOutflow } from "../../../src/engine/palette.ts";
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
  /** Row tint, for the totals. Opaque: a phone cell cannot be 30% of
   *  anything, so the web's tints arrive already flattened. */
  fill?: string;
  /** A heavy rule above this row — what separates the totals block
   *  from the rows it totals. */
  rule?: boolean;
};

export default function BudgetScreen() {
  const { state, pullToRefresh, refreshing } = useBudget();
  // THE BUDGET IS READ-ONLY ON THE PHONE, decided 2026-10-13 after
  // fat-fingering into the transaction editor while scrolling.
  //
  // The grid is two scrollers — a pinned label column beside a
  // horizontal run of months — so a finger moving across it is
  // constantly starting gestures on row labels. A tap target inside a
  // surface whose whole purpose is scrolling will be hit by accident,
  // and an accidental hit here opens an editor over a RULE: one
  // mistaken save changes every month the rule generates, which is the
  // most expensive accident available in this app.
  //
  // The web keeps the tap, correctly — a mouse does not scroll by
  // touching what it points at. This is a deliberate difference, not a
  // missing port, and all editing goes through the Ledger, where a row
  // is one dated occurrence and the scope sheet makes you say what you
  // meant before anything changes.

  const { columns, rows } = useMemo(() => {
    const columns = computeBudget(state!, state!.settings.budgetHorizon);
    const layout = computeBudgetLayout(columns, state!.trackerCategories);
    const cats = state!.trackerCategories;
    const out: (Cell | { section: string })[] = [];

    out.push({ section: "INCOME" });
    out.push({ key: "start", label: "Starting point", values: (c) => c.startingPoint });
    out.push({ key: "take", label: "Take-home", values: (c) => c.takeHome, tone: T.income });
    out.push({ key: "checking", label: "Checking", values: (c) => c.tdChecking, tone: T.income });
    // KEYED BY THE ITEM'S ID, labeled by its name. Both were the name,
    // so two items sharing one were a single row drawn twice, each
    // printing whichever figure the lookup found. See budgetLayout.ts.
    for (const r of layout.otherIncome) {
      out.push({ key: `oi-${r.key}`, label: r.name, values: (c) => c.otherInItems[r.key]?.val ?? 0, tone: T.income });
    }
    out.push({ key: "totalIn", label: "TOTAL IN", values: (c) => c.totalIn, tone: T.income, bold: true, fill: T.tintIn, rule: true });

    for (const sec of BUDGET_SECTIONS) {
      const rows = sec.key === "saving" ? layout.savingGroups.flat() : layout.sectionItems[sec.key];
      if (rows.length === 0) continue;
      out.push({ section: sec.label });
      for (const r of rows) {
        const catId = layout.rowCat[r.key];
        // Red is money GONE. A transfer to savings, a contribution or a
        // loan payment leaves the account without being spent, so it
        // prints plain — the same rule the web uses, from the same engine
        // function so the two cannot drift.
        const retained = isRetainedOutflow(roleOfCategory(catId, cats));
        out.push({
          key: `e-${r.key}`, label: r.name,
          values: (c) => Math.abs(c.expenseItems[r.key]?.val ?? 0),
          ...(retained ? {} : { tone: T.expense }),
        });
      }
    }
    // THE TOTALS ARE A BLOCK, and until now the phone did not say so:
    // TOTAL OUT sat flush against the last Saving/Debt row with the
    // same background and the same hairline, so the three figures the
    // screen exists to produce read as three more rows. The web has
    // had a tinted TOTAL OUT and a heavy rule above every total since
    // it was written; this is that, with the tints flattened (T.tintOut).
    out.push({ key: "totalOut", label: "TOTAL OUT", values: (c) => c.totalOut, tone: T.expense, bold: true, fill: T.tintOut, rule: true });
    out.push({ key: "net", label: "MONTHLY NET", values: (c) => c.net, bold: true, rule: true });
    out.push({ key: "cum", label: "CUMULATIVE NET", values: (c) => c.cumulative, bold: true, head: true, rule: true });

    return { columns, rows: out };
  }, [state]);

  return (
    <>
    <ScrollView
      style={styles.wrap}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} tintColor={T.brass} />}
    >
      {/* Said once, and now it says the opposite of what it used to.
          A screen that is read-only has to admit it, or the first
          thing someone does is tap a row and conclude the app is
          broken. */}
      <Text style={styles.hint}>A view of the plan. Edit anything on the Ledger.</Text>

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
              <View
                key={r.key}
                style={[
                  styles.cell, { width: LABEL_W, alignItems: "flex-start" },
                  r.head && styles.cumRow,
                  r.fill != null && { backgroundColor: r.fill },
                  r.rule && styles.ruleAbove,
                ]}
              >
                <Text
                  style={[styles.labelText, r.bold && styles.boldText]}
                  numberOfLines={1}
                >
                  {r.label}
                </Text>
              </View>
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
                    <View
                      key={r.key}
                      style={[
                        styles.cell, { width: COL_W },
                        r.head && styles.cumRow,
                        r.fill != null && { backgroundColor: r.fill },
                        r.rule && styles.ruleAbove,
                      ]}
                    >
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
                          // CUMULATIVE NET is white in both directions,
                          // matching the web, where that row is the one on
                          // the dark bar. It is a running position rather
                          // than a month's win or loss, so coloring it by
                          // sign says something the row does not mean.
                          r.key === "cum" && { color: T.text },
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
  hint: { color: T.faint, fontSize: 11, paddingHorizontal: 16, paddingBottom: 8 },
  boldText: { fontWeight: "700" },
  num: { color: T.dim, fontSize: 12, fontVariant: ["tabular-nums"] },
  cumRow: { backgroundColor: T.surfaceAlt },
  // The web's border-t-2 border-gray-700. Two points, against the
  // hairline every other row carries, is what makes the three figures
  // below read as a block rather than as three more rows.
  ruleAbove: { borderTopWidth: 2, borderTopColor: T.rule },
  foot: { color: T.faint, fontSize: 11, textAlign: "center", paddingVertical: 14 },
});
