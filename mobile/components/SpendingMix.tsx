import { useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Donut, HBar } from "../lib/charts";
import { T, money } from "../lib/theme";
import { spendingSliceColor } from "../../src/engine/model.ts";
import type { SpendingMix as Mix, SpendingSlice } from "../../src/engine/types.ts";

// The web panel, same data and same rules, different primitives.
// Carried over verbatim because they are rules, not layout:
//   - every slice carries its label inline (identity never rests on colour)
//   - item slices carry their parent's name ("Rent · Fixed bills")
//   - the pie NEVER re-shapes; Other expands in the legend only
//   - the bar expands rows in place
//   - open replaces the Other row rather than nesting under it
const prettyDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function SpendingMix({ mix }: { mix: Mix }) {
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [asBar, setAsBar] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);

  const fill = (s: SpendingSlice) => spendingSliceColor(s as never, true);
  const slices = mix.slices;
  const empty = slices.length === 0;
  const barWidth = Math.min(width - 64, 420);

  // Pie keeps the whole Other wedge; the bar replaces the row with its parts.
  const shown = asBar && otherOpen
    ? slices.flatMap((s) => (s.children ? s.children : [s]))
    : slices;

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
              <View style={styles.toggle}>
                {([["Pie", false], ["Bar", true]] as const).map(([label, val]) => (
                  <Pressable
                    key={label}
                    onPress={() => setAsBar(val)}
                    style={[styles.tog, asBar === val && styles.togOn]}
                  >
                    <Text style={[styles.togText, asBar === val && styles.togTextOn]}>{label}</Text>
                  </Pressable>
                ))}
              </View>

              {!asBar && (
                <View style={styles.donutWrap}>
                  <Donut data={slices.map((s) => ({ key: s.key, amount: s.amount, fill: fill(s) }))} size={148} />
                </View>
              )}

              {(asBar ? shown : slices).map((s) => {
                // In PIE mode the Other row opens the legend beneath it and
                // the wedge is untouched; in BAR mode the row is replaced.
                if (!asBar && s.children && otherOpen) {
                  return (
                    <View key={s.key}>
                      {s.children.map((c) => <Row key={c.key} s={c} fill={fill(c)} />)}
                      <Pressable onPress={() => setOtherOpen(false)} style={styles.fold}>
                        <Text style={styles.foldText}>⌃ Fold {s.children.length} back into Other</Text>
                      </Pressable>
                    </View>
                  );
                }
                if (s.children) {
                  return (
                    <Pressable key={s.key} onPress={() => setOtherOpen(true)}>
                      <Row s={s} fill={fill(s)} chevron bar={asBar ? barWidth : 0} total={mix.total} />
                    </Pressable>
                  );
                }
                return <Row key={s.key} s={s} fill={fill(s)} bar={asBar ? barWidth : 0} total={mix.total} />;
              })}

              {asBar && otherOpen && (
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
}: { s: SpendingSlice; fill: string; chevron?: boolean; bar?: number; total?: number }) {
  return (
    <View style={styles.rowWrap}>
      <View style={styles.row}>
        <View style={[styles.swatch, { backgroundColor: fill }]} />
        <Text style={styles.label} numberOfLines={1}>
          {s.label}
          {s.parentLabel ? <Text style={styles.parent}> · {s.parentLabel}</Text> : null}
        </Text>
        {chevron && <Text style={styles.chevSmall}>⌄</Text>}
        <Text style={styles.amount}>{money(s.amount)}</Text>
        <Text style={styles.pct}>{s.percent}%</Text>
      </View>
      {bar > 0 && <HBar pct={total > 0 ? s.amount / total : 0} color={fill} width={bar} />}
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
  toggle: { flexDirection: "row", gap: 6 },
  tog: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, minHeight: 32, justifyContent: "center" },
  togOn: { backgroundColor: T.text },
  togText: { color: T.dim, fontSize: 12 },
  togTextOn: { color: T.bg, fontWeight: "700" },
  donutWrap: { alignItems: "center", paddingVertical: 6 },
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
