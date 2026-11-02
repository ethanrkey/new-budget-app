import { act, fireEvent, render, screen, userEvent, within } from "@testing-library/react-native";
import { normalize } from "../../src/engine/stateShape.ts";
import { computeLedger } from "../../src/engine/compute.ts";
import { fmtLongDay } from "../../src/shared/dates.ts";
import CalendarView from "../components/CalendarView";
import { T } from "../lib/theme";

// THE CALENDAR'S 2026-11-02 POLISH, mounted: the legend, $0 in gray,
// an overdraft in red, the day card that does not shrink within a
// month, and the tap that asks the list to bring the card into view.
// The arithmetic behind each is in tests/calendar.test.mjs; the
// scrolling itself (lib/reveal.ts) is asked questions there too.
//
// Pinned clock, same reasoning as calendar.test.tsx: every fixture day
// below has to sit in the month the calendar opens on.
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

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (n: number) => iso(new Date(2026, 9, 10 + n));
const TODAY = day(0);
const ZERO_DAY = day(1);
const WASH_DAY = day(2);
const OVER_DAY = day(3);

const state = normalize({
  settings: { budgetHorizon: day(60), ledgerHorizon: day(60) },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 100, balanceAsOf: TODAY, order: 0 }],
  trackerCategories: [],
  recurring: [],
  oneoffs: [
    { id: "o-zero", name: "Skipped service", amount: 0, category: "bill", date: ZERO_DAY, order: 0 },
    { id: "o-in", name: "Wash in", amount: 500, category: "income", date: WASH_DAY, order: 1 },
    { id: "o-out", name: "Wash out", amount: 500, category: "bill", date: WASH_DAY, order: 2 },
    { id: "o-big", name: "Tuition", amount: 900, category: "bill", date: OVER_DAY, order: 3 },
  ],
});
const rows = computeLedger(state, day(60)).rows;
const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const cell = (d: string) => within(screen.getByLabelText(new RegExp(`^${fmtLongDay(d)}`)));

async function mount(reveal = jest.fn()) {
  await render(<CalendarView state={state} rows={rows} categories={[]} reveal={reveal} />);
  return reveal;
}

test("one quiet line under the grid says what the numbers are", async () => {
  await mount();
  const legend = screen.getByText("Checking balance at end of day · future days are projected");
  expect(flat(legend.props.style).color).toBe(T.faint);
});

test("the day card says whose balance it is", async () => {
  await mount();
  expect(screen.getByText("Checking balance after:")).toBeOnTheScreen();
});

test("a $0 occurrence is gray, with no minus, and lights no dot", async () => {
  await mount();
  await userEvent.press(screen.getByLabelText(new RegExp(`^${fmtLongDay(ZERO_DAY)}`)));
  const amt = screen.getByText("$0.00");
  expect(flat(amt.props.style).color).toBe(T.faint);
  expect(screen.queryByText("−$0.00")).toBeNull();
  // In the cell: the day nets to nothing, so its net is a gray 0.
  expect(flat(cell(ZERO_DAY).getByText("0").props.style).color).toBe(T.faint);
  expect(screen.getByLabelText(new RegExp(`^${fmtLongDay(ZERO_DAY)}`)).props.accessibilityLabel).not.toMatch(/money out/);
});

test("a day whose ins and outs cancel is a gray 0, not a green one", async () => {
  await mount();
  const net = cell(WASH_DAY).getByText("0");
  expect(flat(net.props.style).color).toBe(T.faint);
  expect(screen.getByLabelText(new RegExp(`^${fmtLongDay(WASH_DAY)}`)).props.accessibilityLabel).toMatch(/no net change/);
});

test("a projected overdraft is red in the cell and in the card", async () => {
  await mount();
  // 100 - 900.
  expect(flat(cell(OVER_DAY).getByText("-800").props.style).color).toBe(T.expense);
  // ...and the day before it, still above zero, is not.
  expect(flat(cell(WASH_DAY).getByText("100").props.style).color).toBe(T.text);
  await userEvent.press(screen.getByLabelText(new RegExp(`^${fmtLongDay(OVER_DAY)}`)));
  expect(flat(screen.getByText("-$800.00").props.style).color).toBe(T.expense);
});

test("a tap asks the list to bring the card into view; opening does not", async () => {
  const reveal = await mount();
  await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
  expect(reveal).not.toHaveBeenCalled();
  await userEvent.press(screen.getByLabelText(new RegExp(`^${fmtLongDay(OVER_DAY)}`)));
  await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
  expect(reveal).toHaveBeenCalledTimes(1);
  // The card itself, so the list can measure it.
  expect(reveal.mock.calls[0][0]).toBeTruthy();
});

test("the card never shrinks within a month", async () => {
  await mount();
  const card = () => screen.getByTestId("calendar-day-card");
  // A busy day laid the card out 300pt tall...
  await act(async () => { fireEvent(card(), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 343, height: 300 } } }); });
  // ...so a quiet one keeps that as its minimum, and the page under
  // the finger does not jump.
  await userEvent.press(screen.getByLabelText(new RegExp(`^${fmtLongDay(day(5))}`)));
  expect(flat(card().props.style).minHeight).toBe(300);
});
