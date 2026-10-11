import { Pressable, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";
import { FIRST_RUN_STEPS } from "../lib/firstRun";

// What a brand-new account sees instead of "Nothing projected in this
// window." — three steps, each one opening a control the phone already
// has.
//
// NOT A WIZARD, and that is the whole design. A ported setup flow would
// be a second way to create the same things, which is a second thing to
// keep correct and a second thing to get out of step with the web. This
// is a signpost: it explains what the screen is for and hands you to
// the real controls, then disappears the moment you have used one.
//
// It also answers App Review's minimum-functionality question, which is
// not a copy problem: a reviewer signing in with Apple gets a fresh
// account, and if the app's answer is "go to our website" then the app
// cannot do its job. It can. Every step below is already on the device.
export default function FirstRun({
  onLogBalance, onAddIncome, onAddBill, online,
}: {
  onLogBalance: () => void;
  onAddIncome: () => void;
  onAddBill: () => void;
  online: boolean;
}) {
  const press = { balance: onLogBalance, income: onAddIncome, bills: onAddBill } as const;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Start here</Text>
      <Text style={styles.lede}>
        This account is empty. Three things and the forecast starts working — all of them on the
        phone, in about a minute.
      </Text>

      {FIRST_RUN_STEPS.map((step, i) => (
        <View key={step.key} style={styles.step}>
          <View style={styles.row}>
            <Text style={styles.num}>{i + 1}</Text>
            <Text style={styles.title}>{step.title}</Text>
          </View>
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
        </View>
      ))}

      {/* Said once, here, and nowhere else: the phone is not a reduced
          version of the web for the things that matter most. */}
      <Text style={styles.note}>
        Everything you add here is the same account as keybudget.app on a computer.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 10 },
  heading: { color: T.brass, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  lede: { color: T.dim, fontSize: 14, lineHeight: 21, marginBottom: 6 },
  step: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 14, padding: 14, gap: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  num: {
    color: T.bg, backgroundColor: T.brass, fontSize: 12, fontWeight: "700",
    width: 20, height: 20, borderRadius: 10, textAlign: "center", lineHeight: 20, overflow: "hidden",
  },
  title: { color: T.text, fontSize: 15, fontWeight: "700", flex: 1 },
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
