import { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBudget } from "../../components/StateProvider";
import { T, money } from "../../lib/theme";
import { computeBudget } from "../../../src/engine/compute.ts";

// The web Budget is a horizontally-scrolling grid with a pinned column.
// RN has no position:sticky, so that is two synced ScrollViews or a frozen
// column — the known trap, and the screen least able to answer "does this
// feel like an app". So: one card per month, vertically. A phone is a
// narrow tall screen, and a wide grid was always a desktop shape.
export default function BudgetScreen() {
  const { state, refresh, refreshing } = useBudget();
  const columns = useMemo(
    () => computeBudget(state!, state!.settings.budgetHorizon),
    [state]
  );

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.pad}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={T.brass} />}
    >
      {columns.map((c) => (
        <View key={c.key} style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.month}>{c.label}</Text>
            <Text style={[styles.net, c.cumulative < 0 && { color: T.expense }]}>
              {money(c.cumulative)}
            </Text>
          </View>
          <View style={styles.line}>
            <Text style={styles.k}>In</Text>
            <Text style={[styles.v, { color: T.income }]}>{money(c.totalIn)}</Text>
          </View>
          <View style={styles.line}>
            <Text style={styles.k}>Out</Text>
            <Text style={[styles.v, { color: T.expense }]}>{money(c.totalOut)}</Text>
          </View>
          <View style={[styles.line, styles.lineLast]}>
            <Text style={styles.k}>Net this month</Text>
            <Text style={[styles.v, (c.totalIn - c.totalOut) < 0 && { color: T.expense }]}>
              {money(c.totalIn - c.totalOut)}
            </Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  pad: { padding: 16, gap: 10, paddingBottom: 32 },
  card: { backgroundColor: T.surface, borderRadius: 14, borderWidth: 1, borderColor: T.border, padding: 14 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  month: { color: T.brass, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  net: { color: T.text, fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  line: {
    flexDirection: "row", justifyContent: "space-between", paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border,
  },
  lineLast: { borderBottomWidth: 0 },
  k: { color: T.dim, fontSize: 14 },
  v: { color: T.text, fontSize: 14, fontVariant: ["tabular-nums"] },
});
