import { act, render, screen, userEvent } from "@testing-library/react-native";
import { Animated, Dimensions, StyleSheet } from "react-native";
import { normalize } from "../../src/engine/stateShape.ts";
import { computeLedger } from "../../src/engine/compute.ts";
import { fmtLongDay, fmtMonthYear } from "../../src/shared/dates.ts";
import CalendarView from "../components/CalendarView";
import { SLIDE_MS, SWIPE_SLOP, dragOffset, isMonthSwipe, releaseTarget } from "../lib/monthSwipe";

// SWIPE TO CHANGE MONTH, AND THE MONTH FOLLOWS THE FINGER (2026-11-11).
//
// Asked for in those words: "the month should follow my finger and
// slide into the next one, not jump. Tapping the arrows should slide
// the same way." So what is checked is POSITION, not just which month
// is named at the end: where the strip is while the finger is down,
// where it is going when the finger lets go, and that the arrows send
// it to the same place. See note 6 in components/CalendarView.tsx.
//
// The finger is the real PanResponder, fed touches by hand — the same
// events iOS hands it — rather than the handlers called with a gesture
// state made up to suit.

const PINNED = new Date(2026, 9, 10, 12, 0);
beforeAll(() => {
  jest.useFakeTimers({
    now: PINNED,
    doNotFake: [
      "hrtime", "nextTick", "performance", "queueMicrotask",
      "requestAnimationFrame", "cancelAnimationFrame",
      "requestIdleCallback", "cancelIdleCallback",
      "setImmediate", "clearImmediate", "setInterval", "clearInterval",
      "setTimeout", "clearTimeout",
    ],
  });
});
afterAll(() => { jest.useRealTimers(); });

const W = Dimensions.get("window").width;
const OCT = "2026-10";
const NOV = "2026-11";
const SEP = "2026-09";

// The as-of date is the 1st of October, so October is the FIRST month
// the calendar has: the left end is in reach of one swipe. January is
// the last.
const state = normalize({
  settings: { budgetHorizon: "2027-01-31", ledgerHorizon: "2027-01-31" },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 3000, balanceAsOf: "2026-10-01", order: 0 }],
  trackerCategories: [],
  recurring: [],
  // One thing in each month, because the calendar's months are the
  // ones with something in them: October to January.
  oneoffs: [
    { id: "o1", name: "Rent", amount: 1200, category: "bill", date: "2026-11-01", order: 0 },
    { id: "o2", name: "Rent", amount: 1200, category: "bill", date: "2026-12-01", order: 1 },
    { id: "o3", name: "Rent", amount: 1200, category: "bill", date: "2027-01-01", order: 2 },
  ],
});
const rows = computeLedger(state, "2027-01-31").rows;

async function mount() {
  await render(<CalendarView state={state} rows={rows} categories={[]} />);
  await screen.findByText(fmtMonthYear(OCT));
}

// WITH THE HIDDEN ONES: the months off screen are hidden from VoiceOver
// on purpose, and so from these queries unless asked.
const byId = (id: string) => screen.getByTestId(id, { includeHiddenElements: true });
const flat = (id: string) => StyleSheet.flatten(byId(id).props.style) ?? {};
/** Where the strip is: −i × width shows month i. */
const stripX = () => {
  const t = (flat("calendar-strip").transform ?? []) as { translateX?: number }[];
  return t.find((x) => "translateX" in x)?.translateX ?? 0;
};
/** Where a month's grid is drawn ON SCREEN: its place on the strip, plus the strip. */
const onScreen = (key: string) => (flat(`calendar-month-${key}`).left as number) + stripX();

// ---- A finger ----
// One touch, as the responder system reports it. PanResponder reads
// these through TouchHistoryMath; a hand-made gesture state would test
// the arithmetic of this file instead of the app's.
function finger() {
  const box = screen.getByTestId("calendar-months");
  let t = 1000;
  const start = { x: 200, y: 300, t };
  let prev = { ...start };
  const history = (x: number, y: number) => ({
    numberActiveTouches: 1,
    indexOfSingleActiveTouch: 0,
    mostRecentTimeStamp: t,
    touchBank: [{
      touchActive: true,
      startPageX: start.x, startPageY: start.y, startTimeStamp: start.t,
      currentPageX: x, currentPageY: y, currentTimeStamp: t,
      previousPageX: prev.x, previousPageY: prev.y, previousTimeStamp: prev.t,
    }],
  });
  const ev = (x: number, y: number) => ({
    nativeEvent: { touches: [{ pageX: x, pageY: y }], pageX: x, pageY: y },
    touchHistory: history(x, y),
  });
  const p = () => box.props;
  let granted = false;
  p().onStartShouldSetResponderCapture(ev(start.x, start.y));
  return {
    /** Move to (dx, dy) from where it went down, over `ms`. */
    move: async (dx: number, dy = 0, ms = 16) => {
      t += ms;
      const x = start.x + dx; const y = start.y + dy;
      await act(async () => {
        if (!granted) {
          // The capture question is asked on every move until it is
          // answered yes, exactly as the responder system asks it.
          if (p().onMoveShouldSetResponderCapture(ev(x, y))) {
            granted = true;
            p().onResponderGrant(ev(x, y));
          }
        } else {
          p().onResponderMove(ev(x, y));
        }
      });
      prev = { x, y, t };
      return granted;
    },
    release: async () => {
      await act(async () => { p().onResponderRelease(ev(prev.x, prev.y)); });
    },
  };
}

// THE CLOCK HAS TO MOVE FOR A SLIDE TO. Date is pinned so the calendar
// opens on October, and Animated times its frames by Date.now(), so a
// frozen clock is a slide that never gets anywhere. Each frame here
// moves the pinned clock on by a frame's worth and then waits for a
// real one.
const settle = () => act(async () => {
  for (let ms = 0; ms < SLIDE_MS + 100; ms += 16) {
    jest.advanceTimersByTime(16);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
});

describe("the rules (lib/monthSwipe.ts)", () => {
  test("a drag is a month swipe only when it is mostly sideways and past the slop", () => {
    expect(isMonthSwipe(SWIPE_SLOP + 1, 0)).toBe(true);
    expect(isMonthSwipe(-(SWIPE_SLOP + 1), 0)).toBe(true);
    // A tap that wobbled.
    expect(isMonthSwipe(SWIPE_SLOP, 0)).toBe(false);
    // The list scrolling, slightly crooked: the list's.
    expect(isMonthSwipe(20, 40)).toBe(false);
    expect(isMonthSwipe(30, 25)).toBe(false);
  });

  test("past either end the pull is a third as far", () => {
    expect(dragOffset(-90, 1, 4)).toBe(-90);
    expect(dragOffset(90, 0, 4)).toBe(30);      // no month before the first
    expect(dragOffset(-90, 3, 4)).toBe(-30);    // none after the last
    expect(dragOffset(-90, 0, 4)).toBe(-90);    // the first can still go forward
  });

  test("a release turns the page past a fifth of the width or on a flick, and never off the end", () => {
    // Left brings in the next month.
    expect(releaseTarget(-0.21 * 375, 0, 375, 1, 4)).toBe(2);
    expect(releaseTarget(0.21 * 375, 0, 375, 1, 4)).toBe(0);
    // Short and slow: back where it was.
    expect(releaseTarget(-0.19 * 375, 0, 375, 1, 4)).toBe(1);
    // Short but flicked.
    expect(releaseTarget(-30, -0.5, 375, 1, 4)).toBe(2);
    // Far, then flicked back: the flick decides.
    expect(releaseTarget(-200, 0.5, 375, 1, 4)).toBe(0);
    // The ends.
    expect(releaseTarget(300, 1, 375, 0, 4)).toBe(0);
    expect(releaseTarget(-300, -1, 375, 3, 4)).toBe(3);
  });
});

describe("the strip", () => {
  test("the months either side are drawn beside this one, off screen, unread and untouchable", async () => {
    await mount();
    // October is the first month: nothing before it, November after.
    expect(screen.queryByTestId(`calendar-month-${SEP}`, { includeHiddenElements: true })).toBeNull();
    expect(onScreen(OCT)).toBe(0);
    expect(onScreen(NOV)).toBe(W);
    const nov = byId(`calendar-month-${NOV}`);
    expect(nov.props.accessibilityElementsHidden).toBe(true);
    expect(nov.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(nov.props.pointerEvents).toBe("none");
    // So a screen reader, and these queries, find only October's days.
    expect(screen.queryByLabelText(new RegExp(`^${fmtLongDay("2026-11-05")}`))).toBeNull();
    expect(screen.getByLabelText(new RegExp(`^${fmtLongDay("2026-10-05")}`))).toBeOnTheScreen();
  });

  test("THE MONTH FOLLOWS THE FINGER, and a short slow drag slides back", async () => {
    await mount();
    const f = finger();
    expect(await f.move(-20)).toBe(true);
    // Every point the finger moves, the grid moves — not on release.
    await f.move(-50, 0, 100);
    expect(onScreen(OCT)).toBe(-30);
    expect(onScreen(NOV)).toBe(W - 30);
    await f.move(-60, 0, 100);
    expect(onScreen(OCT)).toBe(-40);
    // Less than a fifth of the width, slowly: it does not turn.
    await f.release();
    await settle();
    expect(onScreen(OCT)).toBe(0);
    expect(screen.getByText(fmtMonthYear(OCT))).toBeOnTheScreen();
  });

  test("past a fifth of the width it slides the rest of the way into the next month", async () => {
    await mount();
    const f = finger();
    await f.move(-20);
    await f.move(-0.3 * W, 0, 200);
    await f.release();
    // The title changes when the slide lands, not when the finger lifts.
    expect(screen.getByText(fmtMonthYear(OCT))).toBeOnTheScreen();
    await settle();
    expect(screen.getByText(fmtMonthYear(NOV))).toBeOnTheScreen();
    // November is where October was, and nothing jumped to put it
    // there: October is now one width to the left, and December is
    // drawn waiting on the right.
    expect(onScreen(NOV)).toBe(0);
    expect(onScreen(OCT)).toBe(-W);
    expect(onScreen("2026-12")).toBe(W);
    // The card follows the month, as paging always did.
    expect(screen.getByText(fmtLongDay("2026-11-01"))).toBeOnTheScreen();
  });

  test("a flick turns the page however short it is; a swipe back returns", async () => {
    await mount();
    let f = finger();
    await f.move(-20);
    await f.move(-40, 0, 20);        // 20pt in 20ms: 1pt/ms
    await f.release();
    await settle();
    expect(screen.getByText(fmtMonthYear(NOV))).toBeOnTheScreen();

    f = finger();
    await f.move(20);
    await f.move(0.3 * W, 0, 200);
    await f.release();
    await settle();
    expect(screen.getByText(fmtMonthYear(OCT))).toBeOnTheScreen();
    expect(onScreen(OCT)).toBe(0);
  });

  test("at the first month the grid gives a little and comes back", async () => {
    await mount();
    const f = finger();
    await f.move(20);
    await f.move(110, 0, 100);
    // 90pt of finger after the grab, a third of it on the grid.
    expect(onScreen(OCT)).toBe(30);
    await f.release();
    await settle();
    expect(onScreen(OCT)).toBe(0);
    expect(screen.getByText(fmtMonthYear(OCT))).toBeOnTheScreen();
  });

  test("a drag that is mostly up or down is left to the list", async () => {
    await mount();
    const f = finger();
    expect(await f.move(15, 60)).toBe(false);
    expect(await f.move(25, 120)).toBe(false);
    expect(onScreen(OCT)).toBe(0);
  });

  test("THE ARROWS SLIDE THE SAME STRIP, the same way", async () => {
    await mount();
    const timing = jest.spyOn(Animated, "timing");
    await userEvent.press(screen.getByLabelText("Next month"));
    // A slide, to where a swipe would have taken it, not a jump.
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls[0]![1]).toMatchObject({ toValue: -1 * W, duration: SLIDE_MS });
    await settle();
    expect(screen.getByText(fmtMonthYear(NOV))).toBeOnTheScreen();
    expect(onScreen(NOV)).toBe(0);

    await userEvent.press(screen.getByLabelText("Previous month"));
    expect(timing.mock.calls[1]![1]).toMatchObject({ duration: SLIDE_MS });
    expect((timing.mock.calls[1]![1] as { toValue: number }).toValue + 0).toBe(0);
    await settle();
    expect(screen.getByText(fmtMonthYear(OCT))).toBeOnTheScreen();
    expect(onScreen(OCT)).toBe(0);
    timing.mockRestore();
  });

  test("two quick arrow taps go two months, not one", async () => {
    await mount();
    await userEvent.press(screen.getByLabelText("Next month"));
    await userEvent.press(screen.getByLabelText("Next month"));
    await settle();
    expect(screen.getByText(fmtMonthYear("2026-12"))).toBeOnTheScreen();
    expect(onScreen("2026-12")).toBe(0);
  });

  test("the grid's height follows the strip from one month's to the next", async () => {
    await mount();
    const cell = Math.floor((W - 32) / 7);
    // October 2026 starts on a Thursday and runs to a Saturday: 5 weeks.
    // November starts on a Sunday and ends on a Monday: 5 weeks.
    // January 2027 starts on a Friday and has 31 days: 6 weeks.
    expect(flat("calendar-months").height).toBe(5 * (cell + 20));
    await userEvent.press(screen.getByLabelText("Next month"));
    await settle();
    await userEvent.press(screen.getByLabelText("Next month"));
    await settle();
    // December, with January waiting: halfway across, halfway between.
    const f = finger();
    await f.move(-20);
    await f.move(-20 - W / 2, 0, 400);
    expect(flat("calendar-months").height).toBeCloseTo(5.5 * (cell + 20), 0);
    await f.release();
    await settle();
    expect(screen.getByText(fmtMonthYear("2027-01"))).toBeOnTheScreen();
    expect(flat("calendar-months").height).toBe(6 * (cell + 20));
  });
});
