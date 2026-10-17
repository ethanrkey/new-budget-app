import { render, screen, userEvent } from "@testing-library/react-native";
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
// TODAY IS THE REAL TODAY HERE, deliberately. The component reads the
// device clock, which is the thing the rebuild was asked to fix — the
// marked day must never be derived from the balance's as-of date — so
// the fixture is built AROUND whatever date this runs on rather than
// pinned to one, and nothing here would survive the component going
// back to deriving it.
const today = new Date().toISOString().slice(0, 10);
const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
};
const ANCHOR = shift(today, -4);
const HORIZON = shift(today, 120);
const BILL_DAY = shift(today, 2);

const mockState = normalize({
  settings: { budgetHorizon: HORIZON, ledgerHorizon: HORIZON },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: ANCHOR, order: 0 }],
  trackerCategories: [],
  recurring: [],
  oneoffs: [{ id: "o-bill", name: "Car insurance", amount: 150, category: "bill", date: BILL_DAY, order: 0 }],
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

test("NET IS GONE — from the cells and from the panel alike", async () => {
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

test("a day before the as-of date carries no forecast, and says why", async () => {
  await openCalendar();
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
