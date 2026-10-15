import { Pressable, StyleSheet, Text, View } from "react-native";
import { T, money } from "../lib/theme";
import { useBudget } from "./StateProvider";
import { primaryAccount } from "../../src/engine/model.ts";
import { fmtDate } from "../../src/shared/dates.ts";

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
// AND IT SAYS SO SINCE 2026-10-15. It was tappable but gave no sign of
// it: the web has a plain "Update balance" button and the phone had a
// line of text that happened to respond. So the row wears a surface
// and a border — the iOS cue for "this is a control, not a label" —
// and carries "Update ›" at its right, which is the same word the
// web's button uses.
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
  const live = !!onPress && online;

  return (
    <Pressable
      style={({ pressed }) => [styles.wrap, live && styles.live, pressed && styles.pressed]}
      onPress={onPress}
      disabled={!live}
      accessibilityRole={live ? "button" : "summary"}
      accessibilityLabel={
        live
          ? `${account.name} ${money(account.balance)}, verified ${fmtDate(account.balanceAsOf)}. Update the balance.`
          : undefined
      }
    >
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{account.name}</Text>
        <Text style={styles.amount}>{money(account.balance)}</Text>
        {/* Shrinks before the cue does: the date is the thing that can
            be read from the Dashboard, the cue is the thing somebody
            is looking for. */}
        <Text style={styles.asOf} numberOfLines={1}>verified {fmtDate(account.balanceAsOf)}</Text>
      </View>
      {/* Offline is read-only everywhere else, so there is nothing to
          invite here — a cue that opens a form which cannot save is
          worse than no cue. */}
      {live && <Text style={styles.cue}>Update ›</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    // Room for the settings button, which floats at top-right.
    marginLeft: 16, marginRight: 60, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
  },
  // A surface and a border only when there is something to press. A
  // control-shaped thing that does nothing is its own kind of lie.
  live: { backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.border },
  pressed: { opacity: 0.6 },
  info: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 8 },
  name: { color: T.faint, fontSize: 12 },
  amount: { color: T.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  asOf: { color: T.faint, fontSize: 11, flexShrink: 1 },
  cue: { color: T.brass, fontSize: 12, fontWeight: "700" },
});
