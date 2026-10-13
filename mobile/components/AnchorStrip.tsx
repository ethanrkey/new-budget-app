import { Pressable, StyleSheet, Text, View } from "react-native";
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
// COMPACT ON PURPOSE, AND TAPPABLE SINCE 2026-10-14. It is a
// reference, not a headline: one line, no inline editing. But it is
// also the obvious place to reach for when you want to update the
// number it shows, and until now that meant going to the Dashboard
// for something every tab depends on.
//
// Tapping OPENS THE SAME MODAL the Dashboard's card does — it is not a
// second way to log a balance, it is a second door to the one way. The
// web learned the other lesson the hard way: its predecessor was an
// editable bar that committed a new balance on every keystroke, so a
// half-typed number was live state. Nothing changes until Confirm.
//
// The date is never omitted. A balance without an as-of date cannot be
// placed in time, and "the date is half the exception" is the whole
// reason the anchor is allowed in at all.
export default function AnchorStrip({ onPress }: { onPress?: () => void }) {
  const { state, online } = useBudget();
  if (!state) return null;
  const account = primaryAccount(state);

  return (
    <Pressable
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
      onPress={onPress}
      // Offline is read-only everywhere else, so it is read-only here
      // rather than opening a form that cannot save.
      disabled={!onPress || !online}
      accessibilityRole={onPress && online ? "button" : "summary"}
      accessibilityLabel={
        onPress && online
          ? `${account.name} ${money(account.balance)}, verified ${account.balanceAsOf}. Update the balance.`
          : undefined
      }
    >
      <Text style={styles.name} numberOfLines={1}>{account.name}</Text>
      <Text style={styles.amount}>{money(account.balance)}</Text>
      <Text style={styles.asOf}>verified {account.balanceAsOf}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "baseline", gap: 8,
    // Room for the settings button, which floats at top-right.
    paddingLeft: 16, paddingRight: 60, paddingBottom: 8,
  },
  pressed: { opacity: 0.6 },
  name: { color: T.faint, fontSize: 12 },
  amount: { color: T.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  asOf: { color: T.faint, fontSize: 11 },
});
