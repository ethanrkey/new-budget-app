import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from "react-native";
import { SLIDE_MS, dragOffset, isMonthSwipe, releaseTarget } from "../lib/monthSwipe";
import { T, money } from "../lib/theme";
import {
  calendarMonths, buildCalendarMonth, addMonthKey, cellBalancePhone,
  netAmountCompact, netTone, rowTone, rowSign, isOverdrawn, type CalendarDay, type AmountTone,
  type CalendarMonth,
} from "../../src/engine/calendar.ts";
import { categoryLabelOf, todayISO } from "../../src/engine/model.ts";
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
// 3. THE CELL BALANCE HAS A DOLLAR SIGN AND SHRINKS TO FIT
//    (2026-11-07): "$2,864", "-$10", "$12,345", like the web, with no
//    cents. From $100k up it is "$250k" / "$1.3m". The narrowest iPhone
//    that can run this is 375pt wide (deployment target 16.4, so the
//    iPhone SE 2nd gen / iPhone 8 is the floor). That makes the cell
//    floor((375 − 32) / 7) = 49pt, 41pt of text inside the padding and
//    a selected cell's 1pt border. Measured in SF Pro with tabular
//    figures at 11pt: "$2,864" 38.3pt fits as is, "$12,345" 45.3pt and
//    "-$1,234" 43.5pt shrink a little, and the widest, "-$99,999" at
//    50.5pt, draws at 0.81 of 11pt. FIT's 0.75 floor leaves room above
//    that, so a balance shrinks and is never cut off with "…". The
//    +/- line under it stays short and has no dollar sign
//    (cellAmountCompact). Until 2026-11-07 the balance had no dollar
//    sign either, and shortened from $10k ("12.3k").
//
// Kept from the web because they are rules: identity never rests on
// color, so the detail list names the category in words. A balance
// below zero is red and zero is gray, on both clients — see
// isOverdrawn and netTone in engine/calendar.ts (2026-11-02).
//
// 4. A TAP MOVES THE PAGE TO THE BEST SPOT FOR THAT DAY'S CARD, up or
//    down: the lowest position that shows all of it above the tab bar,
//    zero if it fits with the calendar at the top. See
//    src/shared/reveal.ts. The Ledger's list owns the scrolling, so it
//    is handed in as `reveal`. The space under the card (5) is what
//    lets a move back UP animate instead of snapping.
// 5. THE PAGE DOES NOT SHRINK UNDER THE FINGER. Going from a busy day to
//    an empty one made the content shorter, the list clamped its offset,
//    and the whole page jumped up. So a tap holds the space the card
//    sits in at the height it had just before, and the card itself is
//    only as tall as its content. THE HOLD LASTS ONLY WHILE THE PAGE
//    MOVES (2026-11-03): `reveal` calls back once the scroll settles and
//    the space is let go, so the page ends just below the card. It used
//    to keep the month's tallest height for good, which left a big empty
//    area to scroll down into under a short card. Paging a month lets
//    go too.
// 6. A SWIPE TURNS THE MONTH, AND THE MONTH FOLLOWS THE FINGER
//    (2026-11-11). The grids for the month before and after are drawn
//    either side of this one on one long strip, off screen, so a drag
//    pulls the next month in beside the current one rather than
//    swapping it at the end. Let go past a fifth of the width, or
//    flick, and it slides the rest of the way; otherwise it slides
//    back. The arrows slide the same strip the same way. THE STRIP IS
//    POSITIONED BY MONTH, NOT BY SLOT: month i sits at i × width and
//    the strip is moved to −i × width, so when a slide lands and the
//    neighbors are redrawn around the new month, nothing on screen
//    moves and nothing has to be reset — the frame where a reset and
//    a redraw disagree is the flicker this layout cannot have. The
//    rules for when a drag counts and where it lands are in
//    lib/monthSwipe.ts. The title, the picked day and the card change
//    when the slide lands, like the arrows used to on the tap. The
//    off-screen months are hidden from VoiceOver and cannot be
//    touched; the arrows are still how VoiceOver changes month.

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function CalendarView({
  state, rows, categories, onPick, reveal,
}: {
  state: BudgetState;
  rows: LedgerRow[];
  categories: TrackerCategory[];
  onPick?: (id: string) => void;
  /** Scroll the enclosing list so this box is fully visible, and call
   *  `settled` once the list has stopped moving (at once if it did not
   *  need to). */
  reveal?: (box: View, settled: () => void) => void;
}) {
  const { width } = useWindowDimensions();
  const account = state.accounts[0]!;
  const anchor = account.balanceAsOf;
  const horizon = state.settings.ledgerHorizon;
  // THE DEVICE'S DATE, read here and never derived from the anchor.
  // Somebody who last checked their bank on the 3rd is still living
  // on the 17th.
  // LOCAL, NOT UTC. `new Date().toISOString().slice(0, 10)` is the
  // date in Greenwich, so from about 8pm Eastern onward it is
  // tomorrow — the calendar marked the wrong cell as today, opened on
  // the wrong month on the last evening of a month, and dimmed a day
  // that had not happened yet. Same trap toISODate exists to avoid,
  // and the same one the Plaid functions hit on 2026-10-20.
  const today = todayISO();

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
  const detailRef = useRef<View>(null);
  // Only a TAP reveals. Opening the tab, or paging a month, must not
  // scroll anything on its own. A TAP COUNTER, not a flag: tapping the
  // day already picked changes nothing in `picked`, so an effect keyed
  // on it never ran and a flag stayed armed, to fire on the next month
  // change instead.
  const [taps, setTaps] = useState(0);
  const [cardFloor, setCardFloor] = useState(0);
  const spaceHeight = useRef(0);
  useEffect(() => { setCardFloor(0); }, [monthKey]);
  useEffect(() => {
    if (taps === 0) return;
    // A later tap supersedes this one, and its own hold with it.
    let live = true;
    const release = () => { if (live) setCardFloor(0); };
    // One frame, so the new card has been laid out before it is measured.
    const id = requestAnimationFrame(() => {
      if (detailRef.current && reveal) reveal(detailRef.current, release);
      else release();
    });
    return () => { live = false; cancelAnimationFrame(id); };
    // `reveal` is left out on purpose: a new function from the parent
    // is not a tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taps]);
  const pick = (date: string) => {
    setCardFloor(spaceHeight.current);
    setPicked(date);
    setTaps((n) => n + 1);
  };

  const build = (key: string) => buildCalendarMonth({
    key, rows, startBalance: account.balance, anchor, today, horizon, snapshots,
  });
  const month = useMemo(
    () => build(monthKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // The neighbors the strip draws either side (note 6). None when this
  // month is not one of the calendar's, which leaves nothing to swipe to.
  const prevKey = idx > 0 ? months[idx - 1]! : null;
  const nextKey = idx >= 0 && idx < months.length - 1 ? months[idx + 1]! : null;
  const prevMonth = useMemo(
    () => (prevKey ? build(prevKey) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prevKey, rows, account.balance, anchor, today, horizon, snapshots],
  );
  const nextMonth = useMemo(
    () => (nextKey ? build(nextKey) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nextKey, rows, account.balance, anchor, today, horizon, snapshots],
  );

  // The engine's own mapping, not the phone's copy of it — see the web's
  // identical call. A bill flagged "this bill varies" reads as one.
  const catName = (row: LedgerRow) =>
    categoryLabelOf(row.category, { variable: row.variable }, categories);

  // ---- The strip (note 6) ----
  // Where the strip is, in points: −i × width shows month i. One value
  // for the finger, the arrows and the landing.
  const slot = Math.max(idx, 0);
  const pos = useRef(new Animated.Value(-slot * width)).current;
  // The month a slide is heading for, while it slides; and whether a
  // finger is on the strip. Either one means the strip is not at rest
  // and must not be put back by the effect below.
  const heading = useRef<number | null>(null);
  const dragging = useRef(false);
  // What the gesture handlers read. They are made once, and these move.
  const live = useRef({ slot, width, months });
  live.current = { slot, width, months };

  // AT REST, the strip sits on the month shown. This is what lines it up
  // on the first render, after a rotation, and when the list of months
  // changes under it; a landing needs nothing from it, because the strip
  // is already where the new month is.
  useEffect(() => {
    if (heading.current == null && !dragging.current) pos.setValue(-slot * width);
  }, [pos, slot, width]);

  /** The slide has landed on month `to`: it becomes the month shown. */
  function land(to: number) {
    heading.current = null;
    if (to === live.current.slot) return;
    const next = live.current.months[to]!;
    setMonthKey(next);
    // Follow the month rather than clearing: an empty panel under a
    // grid you have just paged into is a worse answer than the 1st's.
    setPicked(`${next}-01`);
  }

  /** Slide the strip to month `to`, from wherever it is now. */
  function slideTo(to: number) {
    heading.current = to;
    Animated.timing(pos, {
      toValue: -to * live.current.width,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      // The JS driver, because the grid's HEIGHT follows the strip too
      // (a 5-week month beside a 6-week one), and height is layout,
      // which the native driver cannot animate.
      useNativeDriver: false,
    }).start(({ finished }) => {
      // An interrupted slide was replaced by another, which lands itself.
      if (finished && heading.current === to) land(to);
    });
  }

  /** A slide still in flight lands now, so the next move starts from it. */
  function landNow(): number {
    const h = heading.current;
    if (h == null) return live.current.slot;
    pos.stopAnimation();
    pos.setValue(-h * live.current.width);
    land(h);
    return h;
  }

  function goMonth(n: number) {
    const from = landNow();
    const to = from + n;
    if (to < 0 || to > live.current.months.length - 1) return;
    slideTo(to);
  }

  // The month the drag started on — the one under the finger at grant.
  const dragFrom = useRef(0);
  const pan = useRef(PanResponder.create({
    // CAPTURE, because the touch starts on a cell, and a cell is a
    // button that has already taken it. Asking on MOVE, never on start,
    // is what leaves a tap a tap.
    onMoveShouldSetPanResponderCapture: (_e, g) => live.current.months.length > 1 && isMonthSwipe(g.dx, g.dy),
    onPanResponderGrant: () => {
      dragging.current = true;
      dragFrom.current = landNow();
    },
    onPanResponderMove: (_e, g) => {
      const { width: w, months: ms } = live.current;
      pos.setValue(-dragFrom.current * w + dragOffset(g.dx, dragFrom.current, ms.length));
    },
    // Once the month is moving, the list does not get to scroll instead.
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_e, g) => {
      dragging.current = false;
      slideTo(releaseTarget(g.dx, g.vx, live.current.width, dragFrom.current, live.current.months.length));
    },
    onPanResponderTerminate: () => {
      dragging.current = false;
      slideTo(dragFrom.current);
    },
  })).current;

  // The window drawn on the strip, each month at its own place on it.
  const panes: { month: CalendarMonth; at: number }[] = [
    ...(prevMonth ? [{ month: prevMonth, at: slot - 1 }] : []),
    { month, at: slot },
    ...(nextMonth ? [{ month: nextMonth, at: slot + 1 }] : []),
  ];
  // THE GRID'S HEIGHT FOLLOWS THE STRIP, so a 6-week month sliding in
  // beside a 5-week one grows the grid as it comes rather than popping a
  // row in at the end. Every row is a cell tall plus the 20 the cell
  // adds; a row is never all padding.
  const heightOf = (m: CalendarMonth) => (m.cells.length / 7) * (cell + 20);
  const gridHeight = panes.length > 1
    ? pos.interpolate({
        // Ascending: the month furthest right sits furthest left.
        inputRange: [...panes].reverse().map((p) => -p.at * width),
        outputRange: [...panes].reverse().map((p) => heightOf(p.month)),
        extrapolate: "clamp",
      })
    : heightOf(month);

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

      <Animated.View style={[styles.clip, { height: gridHeight }]} testID="calendar-months" {...pan.panHandlers}>
        <Animated.View style={{ transform: [{ translateX: pos }] }} testID="calendar-strip">
          {panes.map(({ month: m, at }) => {
            const shown = at === slot;
            return (
              <View
                key={m.key}
                testID={`calendar-month-${m.key}`}
                style={[styles.pane, { left: at * width, width }]}
                // Off screen: not read out, not touchable (note 6).
                accessibilityElementsHidden={!shown}
                importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
                pointerEvents={shown ? "auto" : "none"}
              >
                <MonthGrid month={m} cell={cell} picked={shown ? picked : null} onPick={pick} />
              </View>
            );
          })}
        </Animated.View>
      </Animated.View>

      <Text style={styles.legend}>{COPY.legend}</Text>

      {/* THE SPACE KEEPS THE HEIGHT, NOT THE CARD (2026-11-02, OTA 21).
          OTA 20 put the minimum on the card itself, and a quiet day
          after a busy one drew a big empty bordered box, which looked
          broken. Now the card is exactly as tall as what it says, and
          this wrapper holds the page's length with invisible space
          under it. The wrapper is a column, so the card is not
          stretched to fill it. */}
      {detail && (
        <View
          style={{ minHeight: cardFloor }}
          testID="calendar-day-space"
          onLayout={(e) => { spaceHeight.current = e.nativeEvent.layout.height; }}
        >
        <View ref={detailRef} style={styles.detail} testID="calendar-day-card">
          <Text style={styles.detailHead}>{fmtLongDay(detail.date)}</Text>

          {/* THE HEADLINE, not a footnote. This replaced
              "Net · in · out", which answered a question about the day
              in isolation; this one answers the question the day was
              opened for. */}
          {detail.balance != null ? (
            <View style={styles.balanceLine}>
              <Text style={styles.balanceLabel} numberOfLines={1}>{COPY.balanceAfter}</Text>
              <Text style={[styles.balanceBig, isOverdrawn(detail.balance) && styles.overdrawn]}>{money(detail.balance)}</Text>
            </View>
          ) : detail.logged != null ? (
            // A DIFFERENT SENTENCE, not the same one about a
            // different number: this is what was recorded, not what
            // is projected.
            <View style={styles.balanceLine}>
              <Text style={styles.balanceLabel} numberOfLines={1}>{COPY.loggedBalance}</Text>
              <Text style={[styles.balanceBig, isOverdrawn(detail.logged) && styles.overdrawn]}>{money(detail.logged)}</Text>
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
              <Text style={[styles.detailAmt, { color: TONE_INK[rowTone(r)] }]}>
                {rowSign(r)}{money(Math.abs(r.amount))}
              </Text>
            </Pressable>
          ))}
        </View>
        </View>
      )}
    </ScrollView>
  );
}

/** One month's grid. Drawn for the month shown and, off screen, for the
 *  months either side of it (note 6); `picked` is null on those. */
function MonthGrid({
  month, cell, picked, onPick,
}: {
  month: CalendarMonth;
  cell: number;
  picked: string | null;
  onPick: (date: string) => void;
}) {
  const pick = onPick;
  return (
    <View style={styles.grid}>
      {month.cells.map((c, i) =>
        c === null ? (
          <View key={`pad-${i}`} style={{ width: cell, height: cell + 8 }} />
        ) : (
          <Pressable
            key={c.date}
            onPress={() => pick(c.date)}
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
              <Text style={[styles.bal, isOverdrawn(c.balance) && styles.overdrawn]} {...FIT}>
                {cellBalancePhone(c.balance)}
              </Text>
            )}
            {/* A past day the user recorded a balance on. JUST THE
                NUMBER, like every other cell: a tag under it was
                one more thing to read in 49pt, in a grid whose
                whole job is to be scannable. The distinction lives
                one tap away, in the panel, and in the VoiceOver
                label for anyone who cannot see the grid at all. */}
            {c.balance == null && c.logged != null && (
              <Text style={[styles.bal, isOverdrawn(c.logged) && styles.overdrawn]} {...FIT}>
                {cellBalancePhone(c.logged)}
              </Text>
            )}
            {c.net != null && (
              <Text
                style={[styles.net, { color: TONE_INK[netTone(c.net)] }]}
                numberOfLines={1}
              >
                {netAmountCompact(c.net)}
              </Text>
            )}
          </Pressable>
        ))}
    </View>
  );
}

/** What VoiceOver hears, which is the whole cell in words. */
function ariaFor(c: CalendarDay): string {
  const parts = [fmtLongDay(c.date)];
  if (c.isToday) parts.push("today");
  if (c.balance != null) parts.push(`${COPY.balanceAfter} ${money(c.balance)}`);
  else if (c.logged != null) parts.push(`${COPY.loggedBalance} ${money(c.logged)}`);
  if (c.net != null) {
    const t = netTone(c.net);
    parts.push(t === "zero" ? "no net change" : `${t === "out" ? "down" : "up"} ${money(Math.abs(c.net))}`);
  }
  if (c.rows.length) {
    parts.push(`${c.rows.length} transaction${c.rows.length === 1 ? "" : "s"}`);
    // THE DOTS' MEANING, IN WORDS. They are the one mark in the cell
    // that carries information by color alone.
    if (c.hasIn) parts.push("money in");
    if (c.hasOut) parts.push("money out");
  }
  return parts.join(", ");
}

// THE BALANCE SHRINKS, IT IS NEVER CUT OFF. One line, and iOS scales the
// font down until it fits the cell, to no less than 0.75 of 11pt. See
// note 3 at the top of the file for the measurements.
const FIT = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.75 } as const;

// Direction's ink; zero is the faint gray the card's quiet text wears.
const TONE_INK: Record<AmountTone, string> = { in: T.income, out: T.expense, zero: T.faint };

const styles = StyleSheet.create({
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 10 },
  monthName: { color: T.text, fontSize: 16, fontWeight: "700" },
  arrow: { color: T.brass, fontSize: 28, paddingHorizontal: 10 },
  arrowOff: { color: T.surfaceAlt },
  weekRow: { flexDirection: "row", paddingHorizontal: 16 },
  weekday: { color: T.faint, fontSize: 10, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16 },
  // The window the strip slides behind: as wide as the screen, as tall
  // as the month (gridHeight), and nothing drawn outside it.
  clip: { overflow: "hidden" },
  pane: { position: "absolute", top: 0 },
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
  // ONE LINE, measured 2026-11-02 in SF Pro: "Checking balance after:"
  // is 134.2pt at 12pt and "-$123,456.78" 150.3pt at 22pt bold
  // tabular, so with the 8pt gap the line is 292.5pt in the 313pt a
  // 375pt phone leaves inside the card. If a larger text size ever
  // overflows it, the LABEL gives way (truncates), never the number.
  balanceLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  balanceLabel: { color: T.faint, fontSize: 12, flexShrink: 1 },
  balanceBig: { color: T.text, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"], flexShrink: 0 },
  overdrawn: { color: T.expense },
  // IN INK, like the balances it explains (2026-11-07, the owner's
  // call). It was T.faint. Same size and place.
  legend: { color: T.text, fontSize: 10, textAlign: "center", marginTop: 6, paddingHorizontal: 16 },
  noForecast: { color: T.faint, fontSize: 12 },
  quiet: { color: T.faint, fontSize: 12 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailName: { color: T.text, fontSize: 14, flex: 1 },
  detailCat: { color: T.faint, fontSize: 11 },
  detailAmt: { fontSize: 14, fontVariant: ["tabular-nums"] },
});
