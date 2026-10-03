import { useMemo, useState } from "react";
import {
  Platform, Pressable, RefreshControl, SectionList, StyleSheet, Text, View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useBudget } from "../../components/StateProvider";
import { T, money } from "../../lib/theme";
import { computeLedger, groupByMonth } from "../../../src/engine/compute.ts";
import { ledgerHorizonOf } from "../../../src/engine/model.ts";

// THE SCREEN THIS BUILD EXISTS FOR. The Ledger is the densest list in the
// app, and a long list is where React Native either feels native or does
// not. SectionList with stickySectionHeadersEnabled is the native idiom
// and gives real momentum, rubber-banding and sticky month headers for
// free — the web version had to build all three.
export default function LedgerScreen() {
  const { state, refresh, refreshing } = useBudget();
  // Device-local horizon. Deliberately NOT a write: this build is
  // read-only, and a picker that changes what you see without touching
  // the server still exercises the native picker honestly.
  const [horizon, setHorizon] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const effective = horizon ?? ledgerHorizonOf(state!);
  const { sections, ending } = useMemo(() => {
    const ledger = computeLedger(state!, effective);
    return {
      sections: groupByMonth(ledger.rows).map((g) => ({ title: g.label, data: g.rows })),
      ending: ledger.endingBalance,
    };
  }, [state, effective]);

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <View>
          <Text style={styles.label}>Ending balance</Text>
          <Text style={[styles.ending, ending < 0 && { color: T.expense }]}>{money(ending)}</Text>
        </View>
        <Pressable style={styles.chip} onPress={() => setPicking(true)}>
          <Text style={styles.chipText}>through {effective}</Text>
        </Pressable>
      </View>

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

      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.listPad}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={T.brass} />
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.month}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.day}>{item.date.slice(8)}</Text>
            <View style={styles.name}>
              <Text style={styles.nameText} numberOfLines={1}>{item.name}</Text>
              {item.overridden && <Text style={styles.edited}>· edited</Text>}
            </View>
            <Text style={[styles.amt, { color: item.direction === "in" ? T.income : T.expense }]}>
              {item.direction === "in" ? "+" : "−"}{money(item.amount).replace("-", "")}
            </Text>
            <Text style={[styles.bal, item.negative && { color: T.expense }]}>{money(item.balance)}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Nothing projected in this window.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  toolbar: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 10,
  },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  ending: { color: T.text, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  chip: {
    backgroundColor: T.surface, borderColor: T.border, borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, minHeight: 36, justifyContent: "center",
  },
  chipText: { color: T.dim, fontSize: 13 },
  listPad: { paddingBottom: 28 },
  month: {
    backgroundColor: T.bg, color: T.brass, fontSize: 12, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 16, paddingVertical: 8,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border,
  },
  day: { color: T.faint, width: 22, fontVariant: ["tabular-nums"] },
  name: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  nameText: { color: T.text, fontSize: 15, flexShrink: 1 },
  edited: { color: T.faint, fontSize: 11 },
  amt: { fontSize: 15, fontVariant: ["tabular-nums"] },
  bal: { color: T.dim, fontSize: 13, width: 84, textAlign: "right", fontVariant: ["tabular-nums"] },
  empty: { color: T.faint, textAlign: "center", marginTop: 40 },
});
