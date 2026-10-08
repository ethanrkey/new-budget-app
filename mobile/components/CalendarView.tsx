import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { T, money } from "../lib/theme";
import { groupByDay } from "../../src/engine/compute.ts";
import type { LedgerRow, TrackerCategory } from "../../src/engine/types.ts";

// The web calendar, reshaped for a phone. Two changes made on purpose:
//
// 1. ONE MONTH AT A TIME with ‹ › paging, not a continuous scroll of
//    months. A phone is a narrow tall screen; six squeezed columns beside
//    a seventh is the layout fighting the device.
// 2. The day detail is a panel UNDER the grid, not a popover. Popovers on
//    touch need dismiss affordances and cover the thing you tapped.
//
// Kept from the web because they are rules: dots are capped (not wrapped —
// grid cells share a row height, so wrapping flattens the busy/quiet
// contrast that is the whole point), identity never rests on color so the
// detail list names the category in words, and the running balance stays
// out — a month grid has nowhere honest to put it.
const DOT_CAP = 4;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function CalendarView({
  rows, categories, onPick,
}: { rows: LedgerRow[]; categories: TrackerCategory[]; onPick?: (id: string) => void }) {
  const { width } = useWindowDimensions();
  const days = useMemo(() => groupByDay(rows), [rows]);
  const months = useMemo(() => {
    const seen: string[] = [];
    for (const r of rows) { const m = r.date.slice(0, 7); if (!seen.includes(m)) seen.push(m); }
    return seen.length ? seen : [new Date().toISOString().slice(0, 7)];
  }, [rows]);

  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const month = months[Math.min(idx, months.length - 1)];

  const cell = Math.floor((width - 32) / 7);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = first.getDay();
  const cells: (string | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const catName = (id: string) =>
    id === "bill" ? "Fixed bill" : id === "oneoff" ? "One-off" : id === "income" ? "Income"
      : categories.find((c) => c.id === id)?.name ?? "Uncategorized";
  // The dots mean "something happened here" and nothing else — secondary
  // gray since 2026-10-06, matching the web. A month grid is read for
  // density, and hues scattered through it competed with exactly that.

  const detail = picked ? days.get(picked) : null;

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <View style={styles.monthBar}>
        <Pressable onPress={() => { setIdx((i) => Math.max(0, i - 1)); setPicked(null); }} hitSlop={12}>
          <Text style={[styles.arrow, idx === 0 && styles.arrowOff]}>‹</Text>
        </Pressable>
        <Text style={styles.monthName}>
          {first.toLocaleString("en-US", { month: "long", year: "numeric" })}
        </Text>
        <Pressable onPress={() => { setIdx((i) => Math.min(months.length - 1, i + 1)); setPicked(null); }} hitSlop={12}>
          <Text style={[styles.arrow, idx >= months.length - 1 && styles.arrowOff]}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} style={[styles.weekday, { width: cell }]}>{d}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((date, i) => {
          const day = date ? days.get(date) : null;
          const extra = day ? day.rows.length - DOT_CAP : 0;
          return (
            <Pressable
              key={i}
              disabled={!day}
              onPress={() => setPicked(date)}
              style={[styles.cell, { width: cell, height: cell + 6 }, picked === date && styles.cellOn]}
            >
              {date && <Text style={styles.dayNum}>{Number(date.slice(8))}</Text>}
              <View style={styles.dots}>
                {day?.rows.slice(0, DOT_CAP).map((r) => (
                  <View key={r.id} style={[styles.dot, { backgroundColor: T.faint }]} />
                ))}
                {extra > 0 && <Text style={styles.more}>+{extra}</Text>}
              </View>
              {day && (
                <Text style={[styles.net, day.net < 0 ? { color: T.expense } : { color: T.income }]}>
                  {day.net < 0 ? "−" : "+"}{Math.abs(Math.round(day.net))}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {detail && (
        <View style={styles.detail}>
          <Text style={styles.detailHead}>
            {new Date(picked! + "T00:00:00").toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </Text>
          {detail.rows.map((r) => (
            <Pressable key={r.id} style={styles.detailRow} onPress={() => onPick?.(r.id)}>
              <View style={[styles.dot, { backgroundColor: T.faint }]} />
              <Text style={styles.detailName} numberOfLines={1}>{r.name}</Text>
              {/* Identity never rests on color: the category in words. */}
              <Text style={styles.detailCat}>{catName(r.category)}</Text>
              <Text style={[styles.detailAmt, { color: r.direction === "in" ? T.income : T.expense }]}>
                {r.direction === "in" ? "+" : "−"}{money(r.amount).replace("-", "")}
              </Text>
            </Pressable>
          ))}
          <Text style={styles.detailNet}>
            Net {money(detail.net)} · in {money(detail.inflow)} · out {money(detail.outflow)}
          </Text>
        </View>
      )}
      {!detail && <Text style={styles.hint}>Tap a day for its transactions.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { paddingBottom: 28 },
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  monthName: { color: T.text, fontSize: 16, fontWeight: "700" },
  arrow: { color: T.brass, fontSize: 28, paddingHorizontal: 10 },
  arrowOff: { color: T.surfaceAlt },
  weekRow: { flexDirection: "row", paddingHorizontal: 16 },
  weekday: { color: T.faint, fontSize: 10, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16 },
  cell: { borderWidth: StyleSheet.hairlineWidth, borderColor: T.border, alignItems: "center", paddingTop: 3, gap: 2 },
  cellOn: { backgroundColor: T.surfaceAlt },
  dayNum: { color: T.dim, fontSize: 11 },
  dots: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 2, minHeight: 7 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  more: { color: T.faint, fontSize: 8 },
  net: { fontSize: 9, fontVariant: ["tabular-nums"] },
  detail: { margin: 16, padding: 14, backgroundColor: T.surface, borderRadius: 14, borderWidth: 1, borderColor: T.border, gap: 8 },
  detailHead: { color: T.text, fontWeight: "700" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailName: { color: T.text, fontSize: 14, flex: 1 },
  detailCat: { color: T.faint, fontSize: 11 },
  detailAmt: { fontSize: 14, fontVariant: ["tabular-nums"] },
  detailNet: { color: T.faint, fontSize: 11, paddingTop: 4 },
  hint: { color: T.faint, fontSize: 12, textAlign: "center", paddingVertical: 20 },
});
