import { useState } from "react";
import {
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useBudget } from "../../components/StateProvider";
import { T, money } from "../../lib/theme";
import {
  computeMonthVariance, lastMonthKeys, activeMonthKeys, fixedSoFar,
} from "../../../src/engine/progress.ts";
import { setMonthlyActual, deleteMonthlyActual, upsertItem } from "../../../src/engine/mutate.ts";
import { todayISO } from "../../../src/engine/model.ts";
import type { RecurringItem } from "../../../src/engine/types.ts";

// Plan against reality — the fourth tab, and the only one where a number
// you type is not a forecast.
//
// A straight port of the web's Spending tab, including the two things that
// took it a while to get right: a month before the rule existed reads "not
// due" with no difference rather than pricing the whole expected amount as
// an underspend, and a bill that has been identical for three months
// offers to stop being tracked rather than being argued with up front.
const CADENCE_LABEL: Record<string, string> = {
  weekly: "every week", biweekly: "every 2 weeks", monthly: "monthly", yearly: "yearly",
};
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};

export default function SpendingScreen() {
  const { state, refresh, refreshing, commit, online } = useBudget();
  const items = state!.recurring.filter((r) => r.variable);
  const months = lastMonthKeys(todayISO(), 6);

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.pad}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={T.brass} />}
    >
      <Text style={styles.intro}>
        Items flagged &quot;Track actual vs. budgeted&quot; in their editor. Log the real monthly total once
        you know it — no need to tie it to a date. What you log here never changes your Ledger or
        Budget, which always show the rule&apos;s amount.
      </Text>

      {items.length === 0 ? (
        <Text style={styles.empty}>
          Nothing is flagged for this yet. Edit a bill that moves — groceries, electric, gas — and turn
          on &quot;Track actual vs. budgeted.&quot;
        </Text>
      ) : (
        items.map((item) => (
          <ItemBlock key={item.id} item={item} months={months} online={online} commit={commit} />
        ))
      )}
    </ScrollView>
  );
}

function ItemBlock({
  item, months, online, commit,
}: {
  item: RecurringItem;
  months: string[];
  online: boolean;
  commit: (fn: Parameters<ReturnType<typeof useBudget>["commit"]>[0], label: string) => Promise<boolean>;
}) {
  const { state } = useBudget();
  const actuals = state!.monthlyActuals;
  // An observation, not a warning: offered only once the data says so.
  const fixed = fixedSoFar(item, actuals, months);

  return (
    <View style={styles.card}>
      <Text style={styles.name}>
        {item.name}
        <Text style={styles.budgeted}>
          {"  "}budgeted {money(item.amount)} {CADENCE_LABEL[item.cadence] ?? item.cadence}
        </Text>
      </Text>

      {fixed && (
        <View style={styles.nudge}>
          <Text style={styles.nudgeText}>
            {money(fixed.amount)} every month across {fixed.months} months. Nothing to track here.
          </Text>
          <Pressable
            disabled={!online}
            onPress={() => void commit(
              (s) => upsertItem(s, { ...item, variable: false }),
              `${item.name} untracked`
            )}
            accessibilityRole="button"
            accessibilityLabel={`Stop tracking ${item.name}`}
          >
            <Text style={[styles.untrack, !online && { color: T.faint }]}>Untrack it</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.headRow}>
        <Text style={[styles.h, styles.cMonth]}>Month</Text>
        <Text style={[styles.h, styles.cNum]}>Expected</Text>
        <Text style={[styles.h, styles.cNum]}>Actual</Text>
        <Text style={[styles.h, styles.cNum]}>Difference</Text>
      </View>

      {activeMonthKeys(item, actuals, months).map((mk) => (
        <MonthRow key={mk} item={item} monthKey={mk} online={online} commit={commit} />
      ))}
    </View>
  );
}

function MonthRow({
  item, monthKey, online, commit,
}: {
  item: RecurringItem;
  monthKey: string;
  online: boolean;
  commit: (fn: Parameters<ReturnType<typeof useBudget>["commit"]>[0], label: string) => Promise<boolean>;
}) {
  const { state } = useBudget();
  const v = computeMonthVariance(item, state!.monthlyActuals, monthKey);
  const [draft, setDraft] = useState(v.actual != null ? String(v.actual) : "");

  const save = () => {
    const label = `${item.name}, ${monthLabel(monthKey)}`;
    if (draft.trim() === "") {
      if (v.actual != null) void commit((s) => deleteMonthlyActual(s, item.id, monthKey), `${label} cleared`);
      return;
    }
    const n = Number(draft);
    if (Number.isNaN(n)) { setDraft(v.actual != null ? String(v.actual) : ""); return; }
    if (n === v.actual) return;
    void commit((s) => setMonthlyActual(s, item.id, monthKey, n), label);
  };

  const diffColor = v.difference == null ? T.faint : v.difference > 0 ? T.expense : v.difference < 0 ? T.income : T.dim;

  return (
    <View style={styles.row}>
      <Text style={[styles.cMonth, styles.monthText]}>
        {monthLabel(monthKey)}
        {v.occurrences > 1 ? <Text style={styles.times}>  {v.occurrences}×</Text> : null}
      </Text>
      <Text style={[styles.cNum, styles.num]}>
        {v.occurrences === 0 ? <Text style={styles.notDue}>not due</Text> : money(v.expected)}
      </Text>
      <View style={styles.cNum}>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          placeholder="—"
          placeholderTextColor={T.faint}
          value={draft}
          editable={online}
          onChangeText={setDraft}
          onBlur={save}
          returnKeyType="done"
          onSubmitEditing={save}
          accessibilityLabel={`Actual for ${item.name} in ${monthLabel(monthKey)}`}
        />
      </View>
      {/* A difference against a month with nothing due is not a variance —
          pricing it as one is what made "+$150.00" read as overspending
          when the rule had not started. */}
      <Text style={[styles.cNum, styles.num, { color: diffColor }]}>
        {v.occurrences === 0 || v.difference == null
          ? "—"
          : `${v.difference > 0 ? "+" : ""}${money(v.difference)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  pad: { padding: 16, paddingBottom: 40, gap: 14 },
  intro: { color: T.faint, fontSize: 12, lineHeight: 17 },
  empty: { color: T.faint, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 32 },
  card: { backgroundColor: T.surface, borderRadius: 14, borderWidth: 1, borderColor: T.border, padding: 14, gap: 2 },
  name: { color: T.text, fontSize: 15, fontWeight: "700", marginBottom: 6 },
  budgeted: { color: T.faint, fontSize: 12, fontWeight: "400" },
  nudge: { backgroundColor: T.surfaceAlt, borderRadius: 10, padding: 10, marginBottom: 8, gap: 6 },
  nudgeText: { color: T.dim, fontSize: 12, lineHeight: 17 },
  untrack: { color: T.brass, fontSize: 13, fontWeight: "600", minHeight: 30, lineHeight: 30 },
  headRow: { flexDirection: "row", alignItems: "center", paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
  h: { color: T.faint, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 46, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border },
  cMonth: { flex: 1.3 },
  cNum: { flex: 1, alignItems: "flex-end", textAlign: "right" },
  monthText: { color: T.text, fontSize: 13 },
  times: { color: T.faint, fontSize: 11 },
  num: { color: T.dim, fontSize: 13, fontVariant: ["tabular-nums"] },
  notDue: { color: T.faint, fontSize: 12 },
  input: {
    minWidth: 74, minHeight: 38, borderWidth: 1, borderColor: T.border, borderRadius: 9,
    backgroundColor: T.bg, color: T.text, fontSize: 13, textAlign: "right",
    paddingHorizontal: 8, fontVariant: ["tabular-nums"],
  },
});
