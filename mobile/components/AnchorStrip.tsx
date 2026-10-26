import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { T, money } from "../lib/theme";
import { useBudget } from "./StateProvider";
import { primaryAccount, todayISO } from "../../src/engine/model.ts";
import { fmtDate, fmtShortStamp } from "../../src/shared/dates.ts";
import { pillIsAction, pillStateOf, pillSuffixOf, type Connection } from "../../src/shared/connect.ts";

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
// "AS OF", NOT "VERIFIED", SINCE 2026-10-15. The owner's word, and the
// better one: "verified" is a claim about an act, and what this line
// is actually saying is when the number was true. The savings and
// investment cards keep "logged" — that IS an act you performed, and
// a balance you typed in off a statement is logged rather than
// verified against anything.
//
// TWO LINES, AND THE DATE HAS THE SECOND ONE TO ITSELF.
//
// Reported from a device on build 8: "verified 2026-10-14" was cut off
// at a real balance of $1,234.56. It was, and the reason is arithmetic
// rather than a missing `flexShrink`. On the narrowest iPhone this app
// supports — the 12/13 mini at 360pt — this strip gets
// 360 - 16 (margin) - 60 (room for the floating settings button)
// - 24 (padding) = 260pt of content. Measured in SF Pro at the sizes
// below: "Checking" 53, "$1,234.56" 83.5, "verified 10/14/2026" 101.1,
// "Update ›" 52.5, three gaps 26. That is 316pt in a 260pt box, so
// something had to go — and the only thing carrying `flexShrink` was
// the date.
//
// ONE ROW WAS ASKED FOR AGAIN ON 2026-10-15 AND RE-MEASURED, WITH THE
// SHORTER WORD AND THE SYMBOL BOTH COUNTED. It is still 16.6pt too
// wide, so it is still two rows:
//
//     "Checking"            53.0   (12pt)
//     "$12,345.67"          93.9   (16pt semibold, tabular)
//     pencil.circle         18.0
//     "as of 10/14/2026"    87.7   (11pt)
//     three 8pt gaps        24.0
//     ------------------------------------
//                          276.6   in 260
//
// Closing the gaps to 4pt leaves 264.6 and dropping the date to 10pt
// as well leaves 259.5 — which "fits" by half a point with the
// DEFAULT account name and breaks for any real one. Subtract
// everything that is not the name and the row has 36.4pt left for it;
// the word "Checking" alone needs 53. So one line cannot hold this at
// the narrowest width, and it is not asked to: the date gets its own
// line, where its 87.7pt sits in 260 and CANNOT truncate for any
// balance, any account name, or any date. The first line shrinks the
// ACCOUNT NAME instead, which is the one piece of it that is both
// user-supplied and the least load-bearing.
export default function AnchorStrip({ onPress, connection, syncing = false }: {
  onPress?: () => void;
  /**
   * The bank connection, or null. Passed in rather than read here:
   * this component is on every tab, and four copies of it must not
   * each ask the server the same question.
   *
   * THE BANK'S NAME IS NOT ON THIS STRIP, on the owner's call. The
   * pill says WHEN, not WHO — who is a fact about the account and
   * lives in Settings. What changes here is the second line.
   */
  connection?: Connection | null;
  /** A pull is in flight; the pill says so. See PILL_SUFFIX.syncing. */
  syncing?: boolean;
}) {
  const { state, online } = useBudget();
  if (!state) return null;
  const account = primaryAccount(state);
  const live = !!onPress && online;

  // Which of the newest snapshot's sources the number on screen came
  // from — not the last pull's. That is the whole point of "logged
  // today": when the manual log won the date, saying "synced" would
  // attribute the user's own figure to their bank.
  const newest = (state.accountSnapshots[account.id] ?? []).at(-1);
  const pill = pillStateOf(
    connection ?? null,
    newest?.date === account.balanceAsOf ? newest?.source : undefined,
    account.balanceAsOf,
    todayISO(),
    syncing,
  );
  // LOCAL, both halves. These used to slice the UTC date off the
  // instant and pair it with a local clock, which showed tomorrow's
  // date beside tonight's time. See fmtInstant.
  //
  // AND THE SHORT STAMP CARRIES ITS OWN DAY when it is not today.
  // "synced 8:46 PM" is unambiguous on a phone you have just picked
  // up and a lie on one you have not. See fmtShortStamp.
  const suffix = pillSuffixOf(pill, {
    asOf: fmtDate(account.balanceAsOf),
    syncedTime: fmtShortStamp(connection?.lastSyncedAt),
    syncedWhen: connection?.lastSyncedAt ? fmtShortStamp(connection.lastSyncedAt) : "never",
    // The moment the user typed it. Older rows predate `loggedAt`,
    // and for those the word on its own is still true.
    loggedStamp: newest?.loggedAt ? fmtShortStamp(newest.loggedAt) : "today",
  });

  return (
    <View style={styles.slot} testID="anchor-slot">
    <Pressable
      testID="anchor-box"
      style={({ pressed }) => [styles.wrap, live && styles.live, pressed && styles.pressed]}
      onPress={onPress}
      disabled={!live}
      accessibilityRole={live ? "button" : "summary"}
      accessibilityLabel={
        live
          ? `${account.name} ${money(account.balance)}, ${suffix}. Update the balance.`
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
      {/* GOLD ONLY WHEN IT ASKS FOR SOMETHING. Four of the five
          states describe; "Reconnect" is the one that wants a tap,
          and the accent is spent on it for that reason and not
          because a bank connection is exciting. */}
      <Text style={[styles.asOf, pillIsAction(pill) && styles.action]}>{suffix}</Text>
    </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // IT HUGS ITS CONTENT AND IT IS CAPPED, since 2026-10-16.
    //
    // Reported from a device on build 11: at $4,500.00 the surface ran
    // the full width and left a wide empty right-hand side, which
    // reads as a bar rather than as the control it is.
    //
    // `alignSelf: "flex-start"` ALONE IS NOT THE FIX, and that is
    // worth stating because it is the obvious one-liner. A cross-axis
    // flex-start child sizes to its content and is then free to
    // OVERFLOW its parent — measured with react-native-web at 390pt:
    // a long account name took the box to 356pt in a 314pt slot,
    // pushing its right edge 58pt under the settings button, and the
    // name's `flexShrink` never engaged because nothing was
    // constraining the row.
    //
    // So the margins moved OUT to `slot`, which owns the space, and
    // this owns `maxWidth: "100%"` — a percentage of the slot's
    // content box, which is exactly "everything left of the settings
    // button". Hug, grow, stop: content-sized up to the cap, and at
    // the cap the name shrinks, because now something is constraining
    // the row.
    //
    // The box hugs the WIDER of its two lines, which is the first one:
    // the date is 87.7pt and name + amount + pencil is about 181
    // before padding. So the width tracks the balance, which is what
    // was asked for.
    maxWidth: "100%",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    gap: 1,
  },
  // The space the strip may occupy: everything left of the floating
  // settings button. `alignItems: "flex-start"` is what lets the child
  // be narrower than this.
  slot: { marginLeft: 16, marginRight: 60, marginBottom: 8, alignItems: "flex-start" },
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
  action: { color: T.brass, fontWeight: "700" },
  fallbackCue: { color: T.dim, fontSize: 15 },
});
