import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
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
// TAPPABLE SINCE 2026-10-14, AND IT SAYS SO SINCE 2026-10-15. It was
// tappable and gave no sign of it: the web has a plain "Update
// balance" button and the phone had a line of text that happened to
// respond. So the row wears a surface and a hairline — the iOS cue for
// "this is a control, not a label" — and the balance carries a
// pencil.circle beside it.
//
// THE CUE IS A SYMBOL AND NOT THE WORD "Update ›", since 2026-10-15,
// and that is a width decision as much as a taste one. See below.
//
// Tapping OPENS THE SAME MODAL the Dashboard's card does — it is not a
// second way to log a balance, it is a second door to the one way. The
// web learned the other lesson the hard way: its predecessor was an
// editable bar that committed a new balance on every keystroke, so a
// half-typed number was live state. Nothing changes until Confirm.
//
// TWO LINES, AND THE DATE HAS THE SECOND ONE TO ITSELF.
//
// Reported from a device on build 8: "verified 2026-10-14" was cut off
// at a real balance of $1,276.57. It was, and the reason is arithmetic
// rather than a missing `flexShrink`. On the narrowest iPhone this app
// supports — the 12/13 mini at 360pt — this strip gets
// 360 - 16 (margin) - 60 (room for the floating settings button)
// - 24 (padding) = 260pt of content. Measured in SF Pro at the sizes
// below: "Checking" 53, "$1,276.57" 83.5, "verified 10/14/2026" 101.1,
// "Update ›" 52.5, three gaps 26. That is 316pt in a 260pt box, so
// something had to go — and the only thing carrying `flexShrink` was
// the date.
//
// Deleting the word cue buys 62pt and the symbol costs 18 back, which
// still leaves 272 against 260 at $1,276.57 and 282 at $12,345.67.
// One line cannot hold this, so it is not asked to: the date gets its
// own line, where its 101pt sits in 260 and CANNOT truncate for any
// balance, any account name, or any date. The first line shrinks the
// ACCOUNT NAME instead, which is the one piece of it that is both
// user-supplied and the least load-bearing.
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
      <View style={styles.line} testID="anchor-line">
        <Text style={styles.name} numberOfLines={1}>{account.name}</Text>
        <Text style={styles.amount}>{money(account.balance)}</Text>
        {/* Offline is read-only everywhere else, so there is nothing to
            invite here — a cue that opens a form which cannot save is
            worse than no cue.
            MUTED, NOT BRASS. Gold is this app's accent and it is spent
            on the mark and on money; a pencil is a verb, and a verb in
            the accent color reads as the most important thing on the
            screen, which the edit affordance for a reference figure is
            not. T.dim is the same gray the secondary text wears.
            `fallback` is what renders where SF Symbols do not exist —
            under jest, and on the web build — so the cue is still
            findable there rather than silently absent. */}
        {live && (
          <SymbolView
            name="pencil.circle"
            size={18}
            type="monochrome"
            tintColor={T.dim}
            testID="anchor-edit-cue"
            fallback={<Text testID="anchor-edit-cue" style={styles.fallbackCue}>✎</Text>}
          />
        )}
      </View>
      {/* The date is never omitted. A balance without an as-of date
          cannot be placed in time, and "the date is half the exception"
          is the whole reason the anchor is allowed in at all. It owns
          this line, with no sibling to be squeezed by. */}
      <Text style={styles.asOf}>verified {fmtDate(account.balanceAsOf)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Room for the settings button, which floats at top-right.
    marginLeft: 16, marginRight: 60, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    gap: 1,
  },
  // A surface and a border only when there is something to press. A
  // control-shaped thing that does nothing is its own kind of lie.
  live: { backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.border },
  pressed: { opacity: 0.6 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  // The only shrinkable thing in the strip, and deliberately so.
  name: { color: T.faint, fontSize: 12, flexShrink: 1 },
  amount: { color: T.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  // NO flexShrink. That is the fix, and it only holds because nothing
  // shares this line with it.
  asOf: { color: T.faint, fontSize: 11 },
  fallbackCue: { color: T.dim, fontSize: 15 },
});
