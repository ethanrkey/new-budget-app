import { render, screen, userEvent, within } from "@testing-library/react-native";
import { normalize } from "../../src/engine/stateShape.ts";
import { fmtLongDay, fmtMonthYear } from "../../src/shared/dates.ts";
import { CALENDAR_COPY } from "../../src/content/calendar.ts";

// THE CALENDAR, MOUNTED — rebuilt 2026-10-17 around the projected
// end-of-day checking balance.
//
// The arithmetic is covered without a renderer in
// tests/calendar.test.mjs. What is here is the half that only exists
// mounted, and the half the owner actually reported: the grid used to
// show each day's NET, which is a true number and almost nobody's
// question, and the detail panel footed with "Net · in · out".
//
// THE CLOCK IS PINNED, AND ONLY THE CLOCK. The component reads the
// device clock, which is the thing the rebuild was asked to fix — the
// marked day must never be derived from the balance's as-of date — so
// what is pinned here is the device clock itself, not the answer, and
// nothing below would survive the component going back to deriving it
// from the anchor. The anchor is four days earlier than this date,
// which is what makes the two distinguishable.
//
// IT USED TO BE THE REAL TODAY, and the fixture was laid out around
// it: bill at today+2, payday at +4, both at +6. All five of those
// days have to sit in the month the calendar opens on, which is
// today's, so the suite failed on the 26th of October 2026 — today+6
// was November and the cell it asked for was not on screen. Nobody
// had broken anything; the day had moved. Five fixture days and a
// logged reading before the anchor cannot be fitted into one month
// from an arbitrary starting point, so the starting point stops
// being arbitrary.
//
// 23:30 LOCAL, which is the half of this that is not cosmetic. The
// 15th at half past eleven at night is the 16th in Greenwich, so a
// component that asks `toISOString()` what day it is marks tomorrow —
// a real bug, found on the day this was pinned and fixed in the same
// commit. Only discriminating in a zone behind UTC; here, in Eastern,
// it is.
const PINNED = new Date(2026, 9, 15, 23, 30);
beforeAll(() => {
  jest.useFakeTimers({
    now: PINNED,
    // Date and nothing else. userEvent and the renderer schedule real
    // work on these, and a suite that fakes them waits for ever.
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

// Local, for the reason above: these dates are the ones a person
// standing next to the phone would name.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = iso(PINNED);
const shift = (isoStr: string, days: number) => {
  const [y, m, d] = isoStr.split("-").map(Number);
  return iso(new Date(y!, m! - 1, d! + days));
};
const ANCHOR = shift(today, -4);
const HORIZON = shift(today, 120);
const BILL_DAY = shift(today, 2);
const PAY_DAY = shift(today, 4);
const BOTH_DAY = shift(today, 6);

// Real logged history: one reading a week before the anchor, in the
// same month so a single grid holds both halves.
const LOGGED_DAY = shift(ANCHOR, -3);
const mockState = normalize({
  settings: { budgetHorizon: HORIZON, ledgerHorizon: HORIZON },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: ANCHOR, order: 0 }],
  accountSnapshots: {
    checking: [
      { id: "h1", date: LOGGED_DAY, amount: 2750 },
      { id: "h2", date: ANCHOR, amount: 4000 },
    ],
  },
  trackerCategories: [],
  recurring: [],
  oneoffs: [
    { id: "o-bill", name: "Car insurance", amount: 150, category: "bill", date: BILL_DAY, order: 0 },
    { id: "o-pay", name: "Bonus", amount: 400, category: "income", date: PAY_DAY, order: 1 },
    // A payday that also pays a bill — the case the two dots exist for.
    { id: "o-both-in", name: "Refund", amount: 90, category: "income", date: BOTH_DAY, order: 2 },
    { id: "o-both-out", name: "Phone", amount: 45, category: "bill", date: BOTH_DAY, order: 3 },
  ],
});

jest.mock("../lib/supabase", () => ({
  supabase: { auth: { signOut: jest.fn() } },
  BACKEND: "production",
  BACKEND_NOTICE: null,
}));
jest.mock("../lib/store", () => ({
  loadState: jest.fn(async () => mockState),
  saveState: jest.fn(async () => ({ ok: true })),
  resetStore: jest.fn(),
}));

const { StateProvider } = require("../components/StateProvider");
const LedgerScreen = require("../app/(tabs)/index").default;

async function openCalendar() {
  await render(
    <StateProvider userId="u1">
      <LedgerScreen />
    </StateProvider>
  );
  await screen.findByText(/through/);
  await userEvent.press(screen.getByText("Calendar"));
  await screen.findByText(fmtMonthYear(today.slice(0, 7)));
}

test("it opens on today's month, with today already picked", async () => {
  await openCalendar();
  // The detail panel names the day, which is how you can tell what is
  // selected without reading a style.
  expect(screen.getByText(fmtLongDay(today))).toBeOnTheScreen();
});

test("the cell for today is marked, and it is the only one", async () => {
  await openCalendar();
  const marked = screen.getAllByLabelText(/, today($|,)/);
  expect(marked).toHaveLength(1);
  expect(marked[0]!.props.accessibilityLabel).toContain(fmtLongDay(today));
});

test("the detail panel leads with where the balance lands", async () => {
  await openCalendar();
  expect(screen.getByText(CALENDAR_COPY.balanceAfter)).toBeOnTheScreen();
  // Nothing has happened since the anchor, so it is still the anchor.
  expect(screen.getByText("$4,000.00")).toBeOnTheScreen();
});

test("THE OLD NET LINE IS GONE — \"Net X · in Y · out Z\" under the grid", async () => {
  // The panel used to foot with the day's net, its inflow and its
  // outflow, which is a question about the day in isolation. The
  // cells carry a net again since the second round, but as the step
  // the day made in the balance above it — not as a third statistic
  // in a panel that leads with the balance.
  await openCalendar();
  expect(screen.queryByText(/^Net /)).toBeNull();
  expect(screen.queryByText(/· in \$/)).toBeNull();
  expect(screen.queryByText(/· out \$/)).toBeNull();
});

test("a day with something on it shows the balance after it, and names it", async () => {
  await openCalendar();
  await userEvent.press(screen.getByLabelText(new RegExp(`^${fmtLongDay(BILL_DAY)}`)));

  expect(screen.getByText(fmtLongDay(BILL_DAY))).toBeOnTheScreen();
  expect(screen.getByText("Car insurance")).toBeOnTheScreen();
  expect(screen.getByText("Fixed bill")).toBeOnTheScreen();
  // 4000 − 150, and it is the day's END, not its net.
  expect(screen.getByText("$3,850.00")).toBeOnTheScreen();
});

test("a past day the user logged a balance on shows what they logged", async () => {
  // REAL HISTORY AND NOTHING ELSE. The days before the anchor could
  // be filled by running the rules backwards; the result would be
  // fiction, and this app does not show inferred history.
  await openCalendar();
  if (LOGGED_DAY.slice(0, 7) !== today.slice(0, 7)) {
    await userEvent.press(screen.getByLabelText("Previous month"));
  }
  const cell = screen.getByLabelText(new RegExp(`^${fmtLongDay(LOGGED_DAY)}`));
  // THE CELL IS JUST THE NUMBER, like every other cell. A "logged"
  // tag shipped under it for one round and came back out: a second
  // thing to read in a 49pt box, in a grid built to be scanned.
  expect(within(cell).getByText("2,750")).toBeOnTheScreen();
  expect(within(cell).queryByText(/logged/i)).toBeNull();
  // The distinction lives in the panel — and in the label, for
  // anyone who cannot see the grid at all.
  expect(cell.props.accessibilityLabel).toContain(CALENDAR_COPY.loggedBalance);
  expect(cell.props.accessibilityLabel).not.toContain(CALENDAR_COPY.balanceAfter);

  await userEvent.press(cell);
  expect(screen.getByText(CALENDAR_COPY.loggedBalance)).toBeOnTheScreen();
  expect(screen.getByText("$2,750.00")).toBeOnTheScreen();
  // The panel must not call it a forecast.
  expect(screen.queryByText(CALENDAR_COPY.balanceAfter)).toBeNull();
});

test("...and a past day with no reading stays blank", async () => {
  await openCalendar();
  const blank = shift(LOGGED_DAY, -1);
  if (blank.slice(0, 7) !== today.slice(0, 7)) {
    await userEvent.press(screen.getByLabelText("Previous month"));
  }
  const cell = screen.getByLabelText(new RegExp(`^${fmtLongDay(blank)}`));
  expect(cell.props.accessibilityLabel).not.toContain(CALENDAR_COPY.loggedBalance);
  expect(cell.props.accessibilityLabel).not.toContain(CALENDAR_COPY.balanceAfter);
});

test("a day before the as-of date carries no forecast, and says why", async () => {
  await openCalendar();
  // A day with nothing logged on it — the one next to the reading
  // would show the reading.
  const before = shift(ANCHOR, -1);
  // Only reachable if it is in the same month; when the anchor is at
  // the very start of a month the previous day is on the last grid,
  // so page back first.
  if (before.slice(0, 7) !== today.slice(0, 7)) {
    await userEvent.press(screen.getByLabelText("Previous month"));
  }
  await userEvent.press(screen.getByLabelText(new RegExp(`^${fmtLongDay(before)}`)));

  expect(screen.queryByText(CALENDAR_COPY.balanceAfter)).toBeNull();
  expect(screen.getByText(/No forecast before/)).toBeOnTheScreen();
});

test("a dimmed cell never claims a balance to a screen reader", async () => {
  await openCalendar();
  const before = shift(ANCHOR, -1);
  if (before.slice(0, 7) === today.slice(0, 7)) {
    const cell = screen.getByLabelText(new RegExp(`^${fmtLongDay(before)}`));
    expect(cell.props.accessibilityLabel).not.toContain(CALENDAR_COPY.balanceAfter);
  }
  // ...while a covered one always does.
  const covered = screen.getByLabelText(new RegExp(`^${fmtLongDay(BILL_DAY)}`));
  expect(covered.props.accessibilityLabel).toContain(CALENDAR_COPY.balanceAfter);
});

/** Every backgroundColor painted anywhere inside a cell. */
function dotColors(cell: { children: unknown[]; props: Record<string, unknown> }): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { children?: unknown[]; props?: { style?: unknown } };
    const style = Object.assign({}, ...[node.props?.style].flat(Infinity).filter(Boolean)) as
      { backgroundColor?: string; width?: number };
    // The dots are the only painted 4pt squares in a cell; the
    // selected cell's own fill is the other backgroundColor in here.
    if (style.backgroundColor && style.width === 4) out.push(style.backgroundColor);
    (node.children ?? []).forEach(walk);
  };
  walk(cell);
  return out;
}

test("a cell colors its dots by what moved, and says so in words too", async () => {
  const { T } = require("../lib/theme");
  await openCalendar();

  const cellFor = (iso: string) => screen.getByLabelText(new RegExp(`^${fmtLongDay(iso)}`));
  // RED FOR OUT, GREEN FOR IN, both on a day that does both — which
  // is the whole of what the dots say, and the only thing in the cell
  // that says it by color.
  expect(dotColors(cellFor(BILL_DAY))).toEqual([T.expense]);
  expect(dotColors(cellFor(PAY_DAY))).toEqual([T.income]);
  expect(dotColors(cellFor(BOTH_DAY)).sort()).toEqual([T.expense, T.income].sort());
  expect(dotColors(cellFor(shift(BILL_DAY, 1)))).toEqual([]);
  // ...and in words, because identity never rests on color.
  const billCell = cellFor(BILL_DAY);
  expect(billCell.props.accessibilityLabel).toContain("money out");
  expect(billCell.props.accessibilityLabel).not.toContain("money in");
  expect(cellFor(PAY_DAY).props.accessibilityLabel).toContain("money in");
  const both = cellFor(BOTH_DAY).props.accessibilityLabel;
  expect(both).toContain("money in");
  expect(both).toContain("money out");
  expect(cellFor(today).props.accessibilityLabel).not.toContain("money out");
});

test("every balance is the bright number, and the day is the muted one", async () => {
  await openCalendar();
  const { T } = require("../lib/theme");
  const flat = (style: unknown): Record<string, unknown> =>
    Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

  // The bill day: something happens, so its balance reads bright.
  const bill = screen.getByLabelText(new RegExp(`^${fmtLongDay(BILL_DAY)}`));
  const texts = (node: { findAllByType?: unknown }) => node;
  void texts;
  const { getAllByText } = within(bill);
  // 4000 - 150, in the phone's compact format.
  expect(flat(getAllByText("3,850")[0]!.props.style).color).toBe(T.text);
  // ...and the day number beside it is the muted one.
  expect(flat(getAllByText(String(Number(BILL_DAY.slice(8))))[0]!.props.style).color)
    .not.toBe(T.text);

  // EVERY BALANCE IS IN INK, busy day or quiet. It was dimmer on
  // quiet days for one round and that read as two kinds of balance;
  // the dots and the +/- line are what tell them apart.
  const quietDay = shift(BILL_DAY, 1);
  const quiet = screen.getByLabelText(new RegExp(`^${fmtLongDay(quietDay)}`));
  expect(flat(within(quiet).getAllByText("3,850")[0]!.props.style).color).toBe(T.text);
  expect(within(quiet).queryByText(/^[+\u2212]/)).toBeNull();
});

test("a day that moves the balance says by how much, under it", async () => {
  await openCalendar();
  const { T } = require("../lib/theme");
  const flat = (style: unknown): Record<string, unknown> =>
    Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

  const bill = within(screen.getByLabelText(new RegExp(`^${fmtLongDay(BILL_DAY)}`)));
  const net = bill.getByText("−150");
  expect(flat(net.props.style).color).toBe(T.expense);

  // ZERO AND NOTHING ARE DIFFERENT SENTENCES: a quiet day prints no
  // net at all rather than a 0 that did not happen.
  const quiet = within(screen.getByLabelText(new RegExp(`^${fmtLongDay(shift(BILL_DAY, 1))}`)));
  expect(quiet.queryByText("0")).toBeNull();
});
