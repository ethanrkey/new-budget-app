import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBudget } from "../../components/StateProvider";
import { T, money } from "../../lib/theme";
import { computeNetPosition, computeCategoryHistory } from "../../../src/engine/progress.ts";
import { primaryAccount, paletteColor } from "../../../src/engine/model.ts";
import { supabase } from "../../lib/supabase";

// The reality layer, same as the web app: verified balance and the
// balances you logged. No projection here — that is the Ledger's job, and
// the separation is principle 1, not a layout choice.
export default function DashboardScreen() {
  const { state, refresh, refreshing } = useBudget();
  const net = computeNetPosition(state!);
  const account = primaryAccount(state!);
  const cats = [...state!.trackerCategories].sort((a, b) => a.order - b.order);

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.pad}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={T.brass} />}
    >
      <View style={styles.hero}>
        <Text style={styles.label}>Net position</Text>
        <Text style={[styles.heroNum, net.net < 0 && { color: T.expense }]}>{money(net.net)}</Text>
        <Text style={styles.dim}>
          {money(net.cash)} cash · {money(net.assets)} assets · {money(net.debt)} owed
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>{account.name}</Text>
        <Text style={styles.cardNum}>{money(account.balance)}</Text>
        <Text style={styles.dim}>verified {account.balanceAsOf}</Text>
      </View>

      {cats.map((cat) => {
        const history = computeCategoryHistory(state!, cat.id);
        const latest = history.length ? history[history.length - 1] : null;
        const color = paletteColor(cat.color, true);
        return (
          <View key={cat.id} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={styles.cardLabel}>{cat.name}</Text>
            </View>
            <Text style={[styles.cardNum, latest ? { color } : { color: T.faint }]}>
              {latest ? money(latest.amount) : "—"}
            </Text>
            <Text style={styles.dim}>
              {latest ? `logged ${latest.date}` : "no balance logged yet"}
            </Text>
          </View>
        );
      })}

      <Text style={styles.signout} onPress={() => supabase.auth.signOut()}>Sign out</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  pad: { padding: 16, gap: 12, paddingBottom: 32 },
  hero: {
    backgroundColor: T.surface, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: T.border, gap: 4,
  },
  heroNum: { color: T.text, fontSize: 34, fontWeight: "700", fontVariant: ["tabular-nums"] },
  card: {
    backgroundColor: T.surface, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: T.border, gap: 3,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardLabel: { color: T.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  cardNum: { color: T.text, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  label: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  dim: { color: T.faint, fontSize: 12 },
  signout: { color: T.brass, textAlign: "center", paddingVertical: 14 },
});
