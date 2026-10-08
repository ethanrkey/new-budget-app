import { useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { HBar } from "../lib/charts";
import { T, money } from "../lib/theme";
import { sliceFill, DEGRADED_SOLID } from "../../src/engine/palette.ts";
import type { SpendingMix as Mix, SpendingSlice } from "../../src/engine/types.ts";

// The web panel, same data and same rules, different primitives.
// Carried over verbatim because they are rules, not layout:
//   - every slice carries its label inline (identity never rests on color)
//   - item slices carry their parent's name ("Rent · Fixed bills")
//   - the pie NEVER re-shapes; Other expands in the legend only
//   - the bar expands rows in place
//   - open replaces the Other row rather than nesting under it
const prettyDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function SpendingMix({ mix }: { mix: Mix }) {
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);

  // The account's own hue, one color for every loan, slate for spending,
  // gray for Other — from the same function the web calls, so the two
  // clients cannot disagree about what color an account is. The phone is
  // hardcoded dark. A null fill is an account past the eighth hue.
  const fill = (sl: SpendingSlice) => sliceFill(sl, true);
  const slices = mix.slices;
  const empty = slices.length === 0;
  const barWidth = Math.min(width - 64, 420);

  // Opening Other replaces its row with its parts, in place.
  const shown = otherOpen ? slices.flatMap((sl) => sl.children ?? [sl]) : slices;

  return (
    <View style={styles.panel}>
      <Pressable style={styles.head} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.headLabel}>Planned spending</Text>
        <Text style={styles.headTotal}>{money(mix.total)}</Text>
        <Text style={styles.chev}>{open ? "⌃" : "⌄"}</Text>
      </Pressable>

      {open && (
        <View style={styles.body}>
          <Text style={styles.caption}>
            Projected from your rules for {prettyDate(mix.from)} – {prettyDate(mix.to)} — not what
            you&apos;ve logged. Income is excluded.
          </Text>

          {empty ? (
            <Text style={styles.empty}>Nothing going out in this window yet.</Text>
          ) : (
            <>
              {shown.map((sl) => {
                if (sl.children) {
                  return (
                    <Pressable key={sl.key} onPress={() => setOtherOpen(true)}>
                      <Row s={sl} fill={fill(sl)} chevron bar={barWidth} total={mix.total} />
                    </Pressable>
                  );
                }
                return <Row key={sl.key} s={sl} fill={fill(sl)} bar={barWidth} total={mix.total} />;
              })}

              {otherOpen && (
                <Pressable onPress={() => setOtherOpen(false)} style={styles.fold}>
                  <Text style={styles.foldText}>⌃ Fold back into Other</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

function Row({
  s, fill, chevron, bar = 0, total = 0,
}: { s: SpendingSlice; fill: string | null; chevron?: boolean; bar?: number; total?: number }) {
  // A null fill is an account past the eighth hue: an OUTLINE rather than
  // a color that already belongs to another account. No fill can collide
  // with a fill, and the row's label carries the identity regardless.
  const swatch = fill
    ? { backgroundColor: fill }
    : { borderWidth: 1.5, borderColor: DEGRADED_SOLID.dark };
  return (
    <View style={styles.rowWrap}>
      <View style={styles.row}>
        <View style={[styles.swatch, swatch]} />
        <Text style={styles.label} numberOfLines={1}>
          {s.label}
          {s.parentLabel ? <Text style={styles.parent}> · {s.parentLabel}</Text> : null}
        </Text>
        {chevron && <Text style={styles.chevSmall}>⌄</Text>}
        <Text style={styles.amount}>{money(s.amount)}</Text>
        <Text style={styles.pct}>{s.percent}%</Text>
      </View>
      {bar > 0 && <HBar pct={total > 0 ? s.amount / total : 0} color={fill ?? DEGRADED_SOLID.dark} width={bar} />}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: T.border, borderRadius: 14, marginHorizontal: 16, marginBottom: 10, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  headLabel: { color: T.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  headTotal: { color: T.dim, fontSize: 12, flex: 1 },
  chev: { color: T.faint, fontSize: 14 },
  body: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  caption: { color: T.faint, fontSize: 11, lineHeight: 15 },
  empty: { color: T.faint, textAlign: "center", paddingVertical: 14 },
  rowWrap: { gap: 3, paddingVertical: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 7 },
  swatch: { width: 9, height: 9, borderRadius: 2 },
  label: { color: T.text, fontSize: 13, flex: 1 },
  parent: { color: T.faint },
  chevSmall: { color: T.faint, fontSize: 11 },
  amount: { color: T.dim, fontSize: 12, fontVariant: ["tabular-nums"] },
  pct: { color: T.faint, fontSize: 11, width: 44, textAlign: "right", fontVariant: ["tabular-nums"] },
  fold: { paddingVertical: 7 },
  foldText: { color: T.faint, fontSize: 11 },
});
