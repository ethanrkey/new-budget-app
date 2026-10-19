import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { T, money } from "../lib/theme";
import {
  calendarMonths, buildCalendarMonth, addMonthKey, cellAmountCompact,
  netAmountCompact, type CalendarDay,
} from "../../src/engine/calendar.ts";
import { categoryLabelOf } from "../../src/engine/model.ts";
import { CALENDAR_COPY as COPY } from "../../src/content/calendar.ts";
import { fmtDate, fmtLongDay, fmtMonthYear } from "../../src/shared/dates.ts";
import type { BudgetState, LedgerRow, TrackerCategory } from "../../src/engine/types.ts";

// The web calendar, reshaped for a phone — and rebuilt around the same
// number on 2026-10-17. The arithmetic, including which days have no
// forecast at all, is shared in src/engine/calendar.ts; the words are
// shared in src/content/calendar.ts. What is decided HERE is width:
//
// 1. ONE MONTH AT A TIME with ‹ › paging, not a continuous scroll of
//    months. A phone is a narrow tall screen; six squeezed columns
//    beside a seventh is the layout fighting the device.
// 2. The day detail is a panel UNDER the grid, not a popover. Popovers
//    on touch need dismiss affordances and cover the thing you tapped.
// 3. THE CELL NUMBER IS SHORTENED — "2,545", "12.3k", no dollar sign
//    and no cents. The narrowest iPhone that can run this is 375pt
//    wide (deployment target 16.4, so iPhone SE 2nd gen / iPhone 8 is
//    the floor; nothing 320pt gets past iOS 15). That makes the cell
//    floor((375 − 32) / 7) = 49pt, and 43pt of it usable inside the
//    padding. Measured in SF Pro with tabular figures at 11pt, the
//    widest string the formatter can produce for a real balance,
//    "-9,999", is 36.6pt, and the absurd billion-dollar "-1000m" is
//    42.9pt. Both fit. At 12pt the second one does not.
//
// Kept from the web because they are rules: identity never rests on
// color, so the detail list names the category in words, and there
// are NO warning tints — a negative projected balance is a minus sign.

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function CalendarView({
  state, rows, categories, onPick,
}: {
  state: BudgetState;
  rows: LedgerRow[];
  categories: TrackerCategory[];
  onPick?: (id: string) => void;
}) {
  const { width } = useWindowDimensions();
  const account = state.accounts[0]!;
  const anchor = account.balanceAsOf;
  const horizon = state.settings.ledgerHorizon;
  // THE DEVICE'S DATE, read here and never derived from the anchor.
  // Somebody who last checked their bank on the 3rd is still living
  // on the 17th.
  const today = new Date().toISOString().slice(0, 10);

  // The checking account's own logged readings — real history, and
  // the only thing a past cell is allowed to show. The days before
  // the anchor could be filled by running the rules backwards; the
  // result would be fiction. A rule says what is supposed to happen,
  // the past is what did.
  const snapshots = useMemo(
    () => state.accountSnapshots?.[account.id] ?? [],
    [state.accountSnapshots, account.id],
  );
  const months = useMemo(
    () => calendarMonths(rows, anchor, today, snapshots),
    [rows, anchor, today, snapshots],
  );
  // Opens on today, with today picked — the old version opened on the
  // month the first row fell in, with nothing picked, so the first
  // thing it showed was a grid you had to navigate before it said
  // anything at all.
  const [monthKey, setMonthKey] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState<string>(today);

  const month = useMemo(
    () => buildCalendarMonth({
      key: monthKey, rows, startBalance: account.balance,
      anchor, today, horizon, snapshots,
    }),
    [monthKey, rows, account.balance, anchor, today, horizon, snapshots],
  );
  const detail = useMemo(
    () => month.cells.find((c) => c?.date === picked) ?? null,
    [month, picked],
  );

  const cell = Math.floor((width - 32) / 7);
  const idx = months.indexOf(monthKey);
  const atFirst = idx <= 0;
  const atLast = idx < 0 || idx >= months.length - 1;

  // The engine's own mapping, not the phone's copy of it — see the web's
  // identical call. A bill flagged "this bill varies" reads as one.
  const catName = (row: LedgerRow) =>
    categoryLabelOf(row.category, { variable: row.variable }, categories);

  function goMonth(n: number) {
    const next = addMonthKey(monthKey, n);
    setMonthKey(next);
    // Follow the month rather than clearing: an empty panel under a
    // grid you have just paged into is a worse answer than the 1st's.
    setPicked(`${next}-01`);
  }

  // NO BOTTOM PADDING OF ITS OWN. This ScrollView is nested inside the
  // Ledger's list, which is the surface that actually scrolls and
  // which owns the inset clearing the floating tab bar. A second
  // number here would be the one that is wrong on a phone nobody has
  // tried yet.
  return (
    <ScrollView>
      <View style={styles.monthBar}>
        <Pressable onPress={() => !atFirst && goMonth(-1)} hitSlop={12}
          accessibilityRole="button" accessibilityLabel="Previous month">
          <Text style={[styles.arrow, atFirst && styles.arrowOff]}>‹</Text>
        </Pressable>
        <Text style={styles.monthName}>{fmtMonthYear(monthKey)}</Text>
        <Pressable onPress={() => !atLast && goMonth(1)} hitSlop={12}
          accessibilityRole="button" accessibilityLabel="Next month">
          <Text style={[styles.arrow, atLast && styles.arrowOff]}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} style={[styles.weekday, { width: cell }]}>{d}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {month.cells.map((c, i) =>
          c === null ? (
            <View key={`pad-${i}`} style={{ width: cell, height: cell + 8 }} />
          ) : (
            <Pressable
              key={c.date}
              onPress={() => setPicked(c.date)}
              style={[
                styles.cell,
                { width: cell, height: cell + 20 },
                c.dim && styles.cellDim,
                picked === c.date && styles.cellOn,
              ]}
              accessibilityRole="button"
              accessibilityLabel={ariaFor(c)}
            >
              {/* TODAY AND THE SELECTED DAY ARE DIFFERENT MARKS, and
                  must stay different: selection is the cell's fill and
                  border, today is a bold number with a rule under it. */}
              <View style={styles.dayRow}>
                <Text style={[styles.dayNum, c.isToday && styles.dayToday]}>{c.day}</Text>
                {/* ONE DOT PER DIRECTION, colored by what moved —
                    red out, green in, both on a payday that also pays
                    a bill. The same two colors every amount in this
                    app already wears, so it is a fact rather than a
                    verdict; see netAmountFull in engine/calendar.ts
                    for why that is not the rule about warning tints.
                    Identity never rests on color: the VoiceOver label
                    says it in words and the panel below lists them. */}
                {c.hasOut && <View style={[styles.dot, { backgroundColor: T.expense }]} />}
                {c.hasIn && <View style={[styles.dot, { backgroundColor: T.income }]} />}
              </View>
              {c.balance != null && (
                // IN INK ON EVERY DAY IT EXISTS, busy or quiet. It
                // was dimmer on quiet days for one round and that
                // read as two kinds of balance; the dots and the
                // +/- line are what tell the two apart.
                <Text style={styles.bal} numberOfLines={1}>
                  {cellAmountCompact(c.balance)}
                </Text>
              )}
              {/* A past day the user recorded a balance on. JUST THE
                  NUMBER, like every other cell: a tag under it was
                  one more thing to read in 49pt, in a grid whose
                  whole job is to be scannable. The distinction lives
                  one tap away, in the panel, and in the VoiceOver
                  label for anyone who cannot see the grid at all. */}
              {c.balance == null && c.logged != null && (
                <Text style={styles.bal} numberOfLines={1}>
                  {cellAmountCompact(c.logged)}
                </Text>
              )}
              {c.net != null && (
                <Text
                  style={[styles.net, { color: c.net < 0 ? T.expense : T.income }]}
                  numberOfLines={1}
                >
                  {netAmountCompact(c.net)}
                </Text>
              )}
            </Pressable>
          ))}
      </View>

      {detail && (
        <View style={styles.detail}>
          <Text style={styles.detailHead}>{fmtLongDay(detail.date)}</Text>

          {/* THE HEADLINE, not a footnote. This replaced
              "Net · in · out", which answered a question about the day
              in isolation; this one answers the question the day was
              opened for. */}
          {detail.balance != null ? (
            <View style={styles.balanceLine}>
              <Text style={styles.balanceLabel}>{COPY.balanceAfter}</Text>
              <Text style={styles.balanceBig}>{money(detail.balance)}</Text>
            </View>
          ) : detail.logged != null ? (
            // A DIFFERENT SENTENCE, not the same one about a
            // different number: this is what was recorded, not what
            // is projected.
            <View style={styles.balanceLine}>
              <Text style={styles.balanceLabel}>{COPY.loggedBalance}</Text>
              <Text style={styles.balanceBig}>{money(detail.logged)}</Text>
            </View>
          ) : (
            <Text style={styles.noForecast}>
              {detail.date < anchor ? COPY.beforeAnchor(fmtDate(anchor)) : COPY.pastHorizon}
            </Text>
          )}

          {detail.rows.length === 0 ? (
            // "Nothing due or expected" is the wrong sentence about a
            // day that has already happened.
            detail.outsideForecast ? null : <Text style={styles.quiet}>{COPY.quiet}</Text>
          ) : detail.rows.map((r) => (
            <Pressable key={r.id} style={styles.detailRow} onPress={() => onPick?.(r.id)}>
              <Text style={styles.detailName} numberOfLines={1}>{r.name}</Text>
              {/* Identity never rests on color: the category in words. */}
              <Text style={styles.detailCat}>{catName(r)}</Text>
              <Text style={[styles.detailAmt, { color: r.direction === "in" ? T.income : T.expense }]}>
                {r.direction === "in" ? "+" : "−"}{money(r.amount).replace("-", "")}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/** What VoiceOver hears, which is the whole cell in words. */
function ariaFor(c: CalendarDay): string {
  const parts = [fmtLongDay(c.date)];
  if (c.isToday) parts.push("today");
  if (c.balance != null) parts.push(`${COPY.balanceAfter} ${money(c.balance)}`);
  else if (c.logged != null) parts.push(`${COPY.loggedBalance} ${money(c.logged)}`);
  if (c.net != null) parts.push(`${c.net < 0 ? "down" : "up"} ${money(Math.abs(c.net))}`);
  if (c.rows.length) {
    parts.push(`${c.rows.length} transaction${c.rows.length === 1 ? "" : "s"}`);
    // THE DOTS' MEANING, IN WORDS. They are the one mark in the cell
    // that carries information by color alone.
    if (c.hasIn) parts.push("money in");
    if (c.hasOut) parts.push("money out");
  }
  return parts.join(", ");
}

const styles = StyleSheet.create({
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  monthName: { color: T.text, fontSize: 16, fontWeight: "700" },
  arrow: { color: T.brass, fontSize: 28, paddingHorizontal: 10 },
  arrowOff: { color: T.surfaceAlt },
  weekRow: { flexDirection: "row", paddingHorizontal: 16 },
  weekday: { color: T.faint, fontSize: 10, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16 },
  cell: { borderWidth: StyleSheet.hairlineWidth, borderColor: T.border, paddingHorizontal: 3, paddingTop: 3, justifyContent: "flex-start" },
  cellDim: { opacity: 0.4 },
  cellOn: { backgroundColor: T.surfaceAlt, borderColor: T.brass, borderWidth: 1 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  // MUTED. The day number is how you find the cell; the balance is
  // what you came to read, so the balance is the white one.
  dayNum: { color: T.faint, fontSize: 11, lineHeight: 14 },
  dayToday: { color: T.text, fontWeight: "700", borderBottomWidth: 2, borderBottomColor: T.text },
  dot: { width: 4, height: 4, borderRadius: 2 },
  // 11pt, measured — see the note at the top of the file.
  bal: { color: T.text, fontSize: 11, lineHeight: 14, marginTop: 1, fontVariant: ["tabular-nums"] },
  net: { fontSize: 9, lineHeight: 11, fontVariant: ["tabular-nums"] },
  detail: { margin: 16, padding: 14, backgroundColor: T.surface, borderRadius: 14, borderWidth: 1, borderColor: T.border, gap: 8 },
  detailHead: { color: T.text, fontWeight: "700" },
  balanceLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  balanceLabel: { color: T.faint, fontSize: 12 },
  balanceBig: { color: T.text, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  noForecast: { color: T.faint, fontSize: 12 },
  quiet: { color: T.faint, fontSize: 12 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailName: { color: T.text, fontSize: 14, flex: 1 },
  detailCat: { color: T.faint, fontSize: 11 },
  detailAmt: { fontSize: 14, fontVariant: ["tabular-nums"] },
});
