import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { T } from "../lib/theme";
import { ABOUT_SECTIONS, type AboutBlock } from "../../src/content/about.ts";
import { ACCOUNT_HUES, LOAN_COLOR, SPENDING_COLOR, NEUTRAL_CHART } from "../../src/engine/palette.ts";

// The web's About page, rendered for a phone — the SAME words, from
// src/content/about.ts, because two copies of an explanation is how one
// of them goes stale. The web draws a sidebar beside a panel; this draws
// a chip row above a full screen, which is the same information at 390px.
const LEGEND = [
  { name: "One per account", hint: "each savings or investment account keeps its own color, everywhere it appears", swatches: ACCOUNT_HUES.dark },
  { name: "Loans", hint: "all of them, one color — which loan a row is, its name says", swatches: [LOAN_COLOR.dark] },
  { name: "Spending", hint: "bills, one-offs, anything not tagged to an account", swatches: [SPENDING_COLOR.dark] },
  { name: "Other", hint: "the folded tail of the spending list", swatches: [NEUTRAL_CHART] },
];

function Block({ block }: { block: AboutBlock }) {
  const [kind, value] = block as [string, unknown];
  if (kind === "p") return <Text style={styles.p}>{value as string}</Text>;
  if (kind === "note") return <Text style={styles.note}>{value as string}</Text>;
  if (kind === "steps") {
    return (
      <View style={styles.list}>
        {(value as string[]).map((t, i) => (
          <Text key={i} style={styles.p}><Text style={styles.strong}>{i + 1}. </Text>{t}</Text>
        ))}
      </View>
    );
  }
  if (kind === "dl") {
    return (
      <View style={styles.list}>
        {(value as [string, string][]).map(([term, def]) => (
          <View key={term} style={styles.dlRow}>
            <Text style={styles.strong}>{term}</Text>
            <Text style={styles.p}>{def}</Text>
          </View>
        ))}
      </View>
    );
  }
  // The legend's swatches are live values from palette.ts, not copy — so
  // the page cannot describe a color the app does not actually use.
  return (
    <View style={styles.list}>
      {LEGEND.map((row) => (
        <View key={row.name} style={styles.dlRow}>
          <View style={styles.swatches}>
            {row.swatches.map((hex) => <View key={hex} style={[styles.swatch, { backgroundColor: hex }]} />)}
          </View>
          <Text style={styles.strong}>{row.name}</Text>
          <Text style={styles.p}>{row.hint}</Text>
        </View>
      ))}
    </View>
  );
}

export default function About({ onStartTour, onClose }: { onStartTour: () => void; onClose: () => void }) {
  const [active, setActive] = useState(ABOUT_SECTIONS[0]!.id);
  const section = ABOUT_SECTIONS.find((s) => s.id === active) ?? ABOUT_SECTIONS[0]!;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>How this app works</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Done">
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {ABOUT_SECTIONS.map((s, i) => (
          <Pressable
            key={s.id}
            onPress={() => setActive(s.id)}
            style={[styles.chip, s.id === active && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: s.id === active }}
            accessibilityLabel={s.title}
          >
            <Text style={[styles.chipText, s.id === active && styles.chipTextOn]}>{i + 1}. {s.title}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h2}>{section.title}</Text>
        {section.body.map((b, i) => <Block key={i} block={b} />)}

        {/* The tour lives inside About for the same reason it does on the
            web: reading about the app and being walked through it are the
            same errand, and a second entry point is a second thing to
            find. */}
        <Pressable style={styles.tour} onPress={onStartTour} accessibilityRole="button" accessibilityLabel="Take the tour">
          <Text style={styles.tourText}>Take the tour</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  title: { color: T.text, fontSize: 18, fontWeight: "700" },
  done: { color: T.brass, fontSize: 15, fontWeight: "600" },
  chips: { paddingHorizontal: 12, gap: 6, paddingBottom: 10 },
  chip: { borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, borderRadius: 999, paddingHorizontal: 12, minHeight: 34, justifyContent: "center" },
  chipOn: { backgroundColor: T.text, borderColor: T.text },
  chipText: { color: T.dim, fontSize: 12 },
  chipTextOn: { color: T.bg, fontWeight: "700" },
  body: { padding: 16, paddingBottom: 48, gap: 12 },
  h2: { color: T.brass, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  p: { color: T.dim, fontSize: 14, lineHeight: 21 },
  strong: { color: T.text, fontSize: 14, fontWeight: "700" },
  note: { color: T.faint, fontSize: 13, lineHeight: 19, borderLeftWidth: 2, borderLeftColor: T.border, paddingLeft: 10 },
  list: { gap: 10 },
  dlRow: { gap: 2 },
  swatches: { flexDirection: "row", gap: 3, marginBottom: 2 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  tour: { marginTop: 18, minHeight: 48, borderRadius: 12, backgroundColor: T.brass, alignItems: "center", justifyContent: "center" },
  tourText: { color: "#111827", fontSize: 15, fontWeight: "700" },
});
