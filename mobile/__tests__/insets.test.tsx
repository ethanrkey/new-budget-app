import { render, screen, userEvent } from "@testing-library/react-native";
import { normalize } from "../../src/engine/stateShape.ts";
import { fmtMonthYear } from "../../src/shared/dates.ts";

// THE FLOATING TAB BAR EATS THE LAST ROW.
//
// `NativeTabs` is a real UITabBarController and its bar is drawn OVER
// the content — correct while scrolling, wrong at rest, because the
// last row of a list stops underneath it and there is no way to
// scroll it out. Reported on the Ledger's calendar: at full scroll
// the bottom edge of the selected-day card sat under the glass.
//
// Every tab is checked, not only the one that was reported, because
// the bar is over all four and the padding that was hiding it was a
// different hand-picked number on each screen (40, 36, 28, and on the
// Budget none at all).
//
// WHAT 50 IS. `useSafeAreaInsets()` is mocked in setup.ts at
// `bottom: 34`, and inside a tab that number is the bar plus the home
// indicator — expo-router gives each tab screen its own
// SafeAreaProvider, so the insets are the screen's and not the
// window's. Plus TAB_CONTENT_GAP, which is 16, so the last row is not
// touching the glass.
//
// WRITTEN OUT RATHER THAN IMPORTED, which is the opposite of the
// usual rule and deliberate. Importing TAB_CONTENT_GAP made the
// expectation move with the thing it was checking: set the gap to 0
// and this file still passed, with every row flush against the bar.
// A test that recomputes the answer from the code is not a test.
const EXPECTED = 50;

const today = new Date().toISOString().slice(0, 10);

// `mock` prefix: jest allows a module factory to reference it.
const mockState = normalize({
  settings: { budgetHorizon: "2027-04-01", ledgerHorizon: "2027-02-01" },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: "2026-10-01", order: 0 }],
  trackerCategories: [{ id: "sav", name: "Ally Savings", order: 0, kind: "asset", assetKind: "savings" }],
  balanceSnapshots: { sav: [{ id: "s1", date: "2026-10-01", amount: 8200 }] },
  recurring: [
    { id: "r-rent", name: "Rent", amount: 1450, category: "bill", order: 0,
      cadence: "monthly", startDate: "2026-10-01", dayOfMonth: 1 },
    // Flagged as varying, so the Spending tab has something to draw.
    { id: "r-gro", name: "Groceries", amount: 400, category: "bill", order: 1,
      cadence: "monthly", startDate: "2026-10-06", dayOfMonth: 6, variable: true },
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

const { StateProvider } = require("../components/StateProvider");

/** One object out of a style array, the way RN resolves it. */
const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

/**
 * Every scroll surface on screen, outermost first.
 *
 * Walked by hand because a content inset is not text and carries no
 * accessibility label, so no query reaches it — and a testID threaded
 * through four screens would be production code existing only for
 * this file. `contentContainerStyle` lands on the host RCTScrollView,
 * for a SectionList as much as for a plain ScrollView.
 */
function scrollViews(): { props: Record<string, unknown> }[] {
  const out: { props: Record<string, unknown> }[] = [];
  const walk = (n: { type?: unknown; props?: Record<string, unknown>; children?: unknown[] } | null) => {
    if (!n || typeof n !== "object") return;
    if (String(n.type) === "RCTScrollView") out.push(n as { props: Record<string, unknown> });
    for (const c of n.children ?? []) walk(c as never);
  };
  walk(screen.root as never);
  return out;
}

/** The bottom padding of the surface that actually scrolls. */
function scrollPad(): unknown {
  return flat(scrollViews()[0]!.props.contentContainerStyle).paddingBottom;
}

async function mount(Tab: React.ComponentType, settled: RegExp | string) {
  await render(
    <StateProvider userId="u1">
      <Tab />
    </StateProvider>
  );
  await screen.findByText(settled);
}

test("the Ledger's list clears the tab bar", async () => {
  const Ledger = require("../app/(tabs)/index").default;
  await mount(Ledger, /through/);
  expect(scrollPad()).toBe(EXPECTED);
});

test("THE ONE REPORTED: the calendar's day card clears the tab bar", async () => {
  const Ledger = require("../app/(tabs)/index").default;
  await mount(Ledger, /through/);
  await userEvent.press(screen.getByText("Calendar"));
  await screen.findByText(fmtMonthYear(today.slice(0, 7)));
  expect(scrollPad()).toBe(EXPECTED);
});

test("the Dashboard clears the tab bar", async () => {
  const Dashboard = require("../app/(tabs)/dashboard").default;
  await mount(Dashboard, "Net position");
  expect(scrollPad()).toBe(EXPECTED);
});

test("the Budget clears the tab bar — it had no bottom padding at all", async () => {
  const Budget = require("../app/(tabs)/budget").default;
  await mount(Budget, "CUMULATIVE NET");
  expect(scrollPad()).toBe(EXPECTED);
});

test("the Spending tab clears the tab bar", async () => {
  const Spending = require("../app/(tabs)/spending").default;
  await mount(Spending, "Month");
  expect(scrollPad()).toBe(EXPECTED);
});

// The calendar is NESTED in the Ledger's list, and the inset belongs
// to the surface that scrolls. A second number inside the calendar
// would be the one nobody remembers to update.
test("the calendar adds no bottom padding of its own", async () => {
  const Ledger = require("../app/(tabs)/index").default;
  await mount(Ledger, /through/);
  await userEvent.press(screen.getByText("Calendar"));
  await screen.findByText(fmtMonthYear(today.slice(0, 7)));
  const inner = scrollViews()[1];
  expect(inner).toBeTruthy();
  expect(flat(inner!.props.contentContainerStyle).paddingBottom).toBeUndefined();
});
