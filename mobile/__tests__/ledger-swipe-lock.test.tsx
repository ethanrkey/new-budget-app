import { act, render, screen, userEvent } from "@testing-library/react-native";
import { ScrollView } from "react-native";
import { normalize } from "../../src/engine/stateShape.ts";
import { fmtMonthYear } from "../../src/shared/dates.ts";
import { SLIDE_MS } from "../lib/monthSwipe";

// ONE DIRECTION PER DRAG, ON THE LEDGER ITSELF (2026-11-11).
//
// The owner, on iOS: "once I start swiping sideways between months, the
// Ledger shouldn't also scroll up and down as my finger drifts. Lock into
// the horizontal swipe until I let go and the month lands." The Ledger's
// list is a native UIScrollView whose pan runs whatever the JS responder
// says, so the only lock that holds is the list's own scrollEnabled. This
// mounts the real Ledger, swipes its calendar with the real PanResponder,
// and checks the list: off from the grant until the month has landed,
// and put back where it was when the finger went down. See note 7 in
// components/CalendarView.tsx.

const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);
const nextMonth = (() => {
  const [y, m] = thisMonth.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
})();

const mockState = normalize({
  settings: { budgetHorizon: "2027-12-01", ledgerHorizon: "2027-12-01" },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: today, order: 0 }],
  trackerCategories: [],
  recurring: [
    { id: "r-rent", name: "Rent", amount: 1450, category: "bill", order: 0,
      cadence: "monthly", startDate: today, dayOfMonth: 1 },
  ],
  oneoffs: [],
});

jest.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), signOut: jest.fn() } },
  BACKEND: "production",
  BACKEND_NOTICE: null,
}));
jest.mock("../lib/store", () => ({
  loadState: jest.fn(async () => mockState),
  saveState: jest.fn(async () => ({ ok: true })),
  resetStore: jest.fn(),
}));

// The jest ScrollView is a stand-in with only render(); give it the two
// methods the Ledger reaches for, so where it scrolls to can be seen.
const scrollTo = jest.fn();
const proto = (ScrollView as unknown as { prototype: Record<string, unknown> }).prototype;
proto.getScrollResponder = function (this: unknown) { return this; };
proto.scrollTo = scrollTo;

const { StateProvider } = require("../components/StateProvider");
const Ledger = require("../app/(tabs)/index").default;

/** Every scroll surface on screen, outermost first (see insets.test.tsx). */
function scrollViews(): { props: Record<string, any> }[] {
  const out: { props: Record<string, any> }[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (String(n.type) === "RCTScrollView") out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(screen.root);
  return out;
}
const list = () => scrollViews()[0]!;
const inner = () => scrollViews()[1]!;

/** One finger on the calendar's grid, as the responder system reports it. */
function finger() {
  const box = screen.getByTestId("calendar-months");
  let t = Date.now();
  const start = { x: 200, y: 300, t };
  let prev = { ...start };
  const ev = (x: number, y: number) => ({
    nativeEvent: { touches: [{ pageX: x, pageY: y }], pageX: x, pageY: y },
    touchHistory: {
      numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: t,
      touchBank: [{
        touchActive: true,
        startPageX: start.x, startPageY: start.y, startTimeStamp: start.t,
        currentPageX: x, currentPageY: y, currentTimeStamp: t,
        previousPageX: prev.x, previousPageY: prev.y, previousTimeStamp: prev.t,
      }],
    },
  });
  const p = () => box.props;
  let granted = false;
  // The finger goes down: the list hears it, then the grid's capture.
  list().props.onTouchStart?.(ev(start.x, start.y));
  p().onStartShouldSetResponderCapture(ev(start.x, start.y));
  return {
    move: async (dx: number, dy = 0, ms = 16) => {
      t += ms;
      const x = start.x + dx; const y = start.y + dy;
      await act(async () => {
        if (!granted) {
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
    release: async () => { await act(async () => { p().onResponderRelease(ev(prev.x, prev.y)); }); },
  };
}

/** iOS scrolled the list to y, the way it reports it. */
const scrolled = (y: number) => act(async () => {
  list().props.onScroll?.({ nativeEvent: {
    contentOffset: { x: 0, y }, contentSize: { width: 390, height: 2000 },
    layoutMeasurement: { width: 390, height: 800 }, zoomScale: 1,
  } });
});
const slide = () => act(async () => { await new Promise((r) => setTimeout(r, SLIDE_MS + 150)); });

async function mount() {
  await render(<StateProvider userId="u1"><Ledger /></StateProvider>);
  await screen.findByText(/through/);
  await userEvent.press(screen.getByText("Calendar"));
  await screen.findByText(fmtMonthYear(thisMonth));
}

beforeEach(() => scrollTo.mockClear());

test("A SIDEWAYS SWIPE LOCKS THE LIST until the finger is up and the month has landed", async () => {
  await mount();
  await scrolled(40);
  expect(list().props.scrollEnabled).not.toBe(false);
  const f = finger();
  // iOS's own pan slid the list a few points before the swipe was sure.
  await scrolled(46);
  expect(await f.move(-14, 4)).toBe(true);
  expect(list().props.scrollEnabled).toBe(false);
  expect(inner().props.scrollEnabled).toBe(false);
  // ...and the list goes back to where the finger went down.
  expect(scrollTo).toHaveBeenCalledWith({ y: 40, animated: false });

  // Drift up and down all the way across: still locked, still sideways.
  await f.move(-80, 60);
  await f.move(-160, -50);
  expect(list().props.scrollEnabled).toBe(false);
  await f.release();
  // Let go, but the month is still sliding in: still locked.
  expect(list().props.scrollEnabled).toBe(false);
  await slide();
  expect(screen.getByText(fmtMonthYear(nextMonth))).toBeOnTheScreen();
  expect(list().props.scrollEnabled).toBe(true);
  expect(inner().props.scrollEnabled).toBe(true);
});

test("a short swipe that slides back unlocks once it is back", async () => {
  await mount();
  const f = finger();
  expect(await f.move(-20, 0, 300)).toBe(true);
  expect(list().props.scrollEnabled).toBe(false);
  await f.release();
  expect(list().props.scrollEnabled).toBe(false);
  await slide();
  expect(screen.getByText(fmtMonthYear(thisMonth))).toBeOnTheScreen();
  expect(list().props.scrollEnabled).toBe(true);
});

test("A DRAG THAT STARTS VERTICAL IS A SCROLL FOR GOOD: the grid never takes it, the list never locks", async () => {
  await mount();
  const f = finger();
  expect(await f.move(2, 20)).toBe(false);
  // Now well sideways: on its own this would be a swipe, but this touch
  // was decided at its first move.
  expect(await f.move(120, 30)).toBe(false);
  expect(await f.move(200, 30)).toBe(false);
  expect(list().props.scrollEnabled).not.toBe(false);
  expect(scrollTo).not.toHaveBeenCalled();
  expect(screen.getByText(fmtMonthYear(thisMonth))).toBeOnTheScreen();

  // The next touch is a new decision.
  const g = finger();
  expect(await g.move(-20)).toBe(true);
  await g.release();
  await slide();
});

test("an arrow tap slides without locking the list", async () => {
  await mount();
  await userEvent.press(screen.getByLabelText("Next month"));
  expect(list().props.scrollEnabled).not.toBe(false);
  await slide();
  expect(list().props.scrollEnabled).not.toBe(false);
});
