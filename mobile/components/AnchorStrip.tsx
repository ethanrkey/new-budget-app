import { StyleSheet, Text, View } from "react-native";
import { T, money } from "../lib/theme";
import { useBudget } from "./StateProvider";
import { primaryAccount } from "../../src/engine/model.ts";

// The verified checking balance, on every tab.
//
// This is the web's AccountStrip, and the reason it is on every tab
// there is the reason it belongs on every tab here: it is the single
// point where reality enters the forecast, and every number on every
// screen is computed forward from it. A Budget column, a Spending
// variance and a Ledger row are all answers to a question whose first
// term was this.
//
// The phone showed it on two tabs of four until 2026-10-13 — the
// Ledger, which led with it, and the Dashboard, which folds it into net
// position. Budget and Spending showed numbers built on a figure that
// was nowhere on the screen.
//
// COMPACT ON PURPOSE. It is a reference, not a headline: one line,
// read-only, no control. The web learned that the hard way — its
// predecessor was an editable bar that committed a new balance on every
// keystroke, so a half-typed number was live state. Logging stays
// behind a modal where nothing changes until Confirm.
//
// The date is never omitted. A balance without an as-of date cannot be
// placed in time, and "the date is half the exception" is the whole
// reason the anchor is allowed in at all.
export default function AnchorStrip() {
  const { state } = useBudget();
  if (!state) return null;
  const account = primaryAccount(state);

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Text style={styles.name} numberOfLines={1}>{account.name}</Text>
      <Text style={styles.amount}>{money(account.balance)}</Text>
      <Text style={styles.asOf}>verified {account.balanceAsOf}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "baseline", gap: 8,
    // Room for the settings button, which floats at top-right.
    paddingLeft: 16, paddingRight: 60, paddingBottom: 8,
  },
  name: { color: T.faint, fontSize: 12 },
  amount: { color: T.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  asOf: { color: T.faint, fontSize: 11 },
});
