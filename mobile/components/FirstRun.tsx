import { Pressable, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";
import { FIRST_RUN_STEPS, firstRunProgress, type StepKey } from "../lib/firstRun";
import type { BudgetState } from "../../src/engine/types.ts";

// What a new account sees above the Ledger — three steps, each one
// opening a control the phone already has.
//
// NOT A WIZARD, and that is the whole design. A ported setup flow would
// be a second way to create the same things, which is a second thing to
// keep correct and a second thing to get out of step with the web. This
// is a signpost: it explains what the screen is for and hands you to
// the real controls.
//
// IT SURVIVES ITS OWN FIRST SUCCESS. The first version keyed off "is
// this account new", which flips on the first write — so logging a
// balance made the whole guide vanish and left a new user on an empty
// Ledger with no sign that two more steps existed. Found on a phone.
// Now each step is ticked off as it is done and the card stays until
// the work is finished or it is put away by hand.
//
// It also answers App Review's minimum-functionality question, which is
// not a copy problem: a reviewer signing in with Apple gets a fresh
// account, and if the app's answer is "go to our website" then the app
// cannot do its job. It can. Every step below is already on the device.
export default function FirstRun({
  state, onLogBalance, onAddIncome, onAddBill, onDismiss, online,
}: {
  state: BudgetState;
  onLogBalance: () => void;
  onAddIncome: () => void;
  onAddBill: () => void;
  onDismiss: () => void;
  online: boolean;
}) {
  const stepState = firstRunProgress(state);
  const press: Record<StepKey, () => void> = {
    balance: onLogBalance, income: onAddIncome, bills: onAddBill,
  };
  const left = FIRST_RUN_STEPS.filter((s) => stepState[s.key] === "todo").length;

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.heading}>Start here</Text>
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide this guide">
          <Text style={styles.hide}>Hide</Text>
        </Pressable>
      </View>
      <Text style={styles.lede}>
        {left === FIRST_RUN_STEPS.length
          ? "This account is empty. Three things and the forecast starts working — all of them on the phone, in about a minute."
          : `${left} to go. The forecast gets more useful with each one.`}
      </Text>

      {FIRST_RUN_STEPS.map((step, i) => {
        const at = stepState[step.key];
        const settled = at !== "todo";
        // A STEP SETTLED BY HAVING NOTHING TO ADD SAYS SO. "Income
        // added" over an account with no income is only ever read by
        // the one person it is wrong for.
        const title = at === "skipped" ? step.skipped ?? step.done : at === "done" ? step.done : step.title;
        return (
        <View key={step.key} style={[styles.step, settled && styles.stepDone]}>
          <View style={styles.row}>
            <Text style={[styles.num, settled && styles.numDone]}>{settled ? "✓" : i + 1}</Text>
            <Text style={[styles.title, settled && styles.titleDone]}>
              {title}
            </Text>
          </View>
          {/* A finished step keeps its tick and loses its instructions.
              Leaving the body and the button there would read as "do it
              again", which is wrong for all three. */}
          {!settled && (
            <>
              <Text style={styles.body}>{step.body}</Text>
              <Pressable
                style={({ pressed }) => [styles.cta, pressed && styles.pressed, !online && styles.off]}
                disabled={!online}
                onPress={press[step.key]}
                accessibilityRole="button"
                accessibilityLabel={step.cta}
              >
                <Text style={styles.ctaText}>{online ? step.cta : "Offline"}</Text>
              </Pressable>
            </>
          )}
        </View>
        );
      })}

      {/* Said once, here, and nowhere else: the phone is not a reduced
          version of the web for the things that matter most. */}
      <Text style={styles.note}>
        Everything you add here is the same account as keybudget.app on a computer.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18, gap: 10 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { color: T.brass, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  hide: { color: T.faint, fontSize: 13 },
  lede: { color: T.dim, fontSize: 14, lineHeight: 21, marginBottom: 6 },
  step: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 14, padding: 14, gap: 6,
  },
  stepDone: { backgroundColor: "transparent", paddingVertical: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  num: {
    color: T.bg, backgroundColor: T.brass, fontSize: 12, fontWeight: "700",
    width: 20, height: 20, borderRadius: 10, textAlign: "center", lineHeight: 20, overflow: "hidden",
  },
  numDone: { color: T.bg, backgroundColor: T.income },
  title: { color: T.text, fontSize: 15, fontWeight: "700", flex: 1 },
  titleDone: { color: T.faint, fontWeight: "600" },
  body: { color: T.dim, fontSize: 13, lineHeight: 19 },
  cta: {
    marginTop: 4, alignSelf: "flex-start", minHeight: 40, justifyContent: "center",
    paddingHorizontal: 16, borderRadius: 10, backgroundColor: T.brass,
  },
  pressed: { opacity: 0.85 },
  off: { opacity: 0.4 },
  ctaText: { color: "#111827", fontSize: 14, fontWeight: "700" },
  note: { color: T.faint, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 6 },
});
