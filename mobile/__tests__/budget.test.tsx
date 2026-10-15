import { render, screen } from "@testing-library/react-native";
import { normalize } from "../../src/engine/stateShape.ts";
import { T } from "../lib/theme";

// The Budget's TOTALS BLOCK, which is the part of this screen that is
// about presentation rather than arithmetic — the numbers come from
// computeBudget and the engine suite checks those with real money.
//
// What only exists mounted is whether the three figures the screen
// exists to produce read as a block. They did not: TOTAL OUT sat
// flush against the last Saving/Debt row with the same background and
// the same hairline.

// `mock` prefix: jest allows a module factory to reference it.
const mockLoaded: { state: unknown } = { state: null };

jest.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), signOut: jest.fn() } },
  BACKEND: "production",
  BACKEND_NOTICE: null,
}));
jest.mock("../lib/store", () => ({
  loadState: jest.fn(async () => mockLoaded.state),
  saveState: jest.fn(async () => ({ ok: true })),
  resetStore: jest.fn(),
}));

const { StateProvider } = require("../components/StateProvider");
const Budget = require("../app/(tabs)/budget").default;

beforeEach(async () => {
  const AsyncStorage = require("@react-native-async-storage/async-storage");
  await AsyncStorage.clear();
  mockLoaded.state = normalize({
    accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: "2026-10-01", order: 0 }],
    trackerCategories: [{ id: "sav", name: "Ally Savings", order: 0, kind: "asset", assetKind: "savings" }],
    recurring: [
      { id: "r1", name: "Paycheck", amount: 2100, category: "income", cadence: "biweekly", startDate: "2026-10-02", order: 0 },
      { id: "r2", name: "Rent", amount: 1450, category: "bill", cadence: "monthly", startDate: "2026-10-01", dayOfMonth: 1, order: 1 },
      { id: "r3", name: "To savings", amount: 200, category: "saving", cadence: "monthly", startDate: "2026-10-05", dayOfMonth: 5, order: 2, trackerCategoryId: "sav" },
    ],
    oneoffs: [],
  });
});

async function mount() {
  await render(
    <StateProvider userId="u1">
      <Budget />
    </StateProvider>
  );
  await screen.findByText("TOTAL OUT");
}

/** Every style object a node carries, flattened into one. */
function styleOf(node: { props: { style?: unknown } }) {
  const flat: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (Array.isArray(s)) s.forEach(walk);
    else if (s && typeof s === "object") Object.assign(flat, s);
  };
  walk(node.props.style);
  return flat;
}

/** The cell a row's label sits in — the pinned column's row. */
const rowCell = (label: string) => screen.getByText(label).parent!;

test("the totals are a block: TOTAL OUT is tinted and sits under a heavy rule", async () => {
  await mount();

  const out = styleOf(rowCell("TOTAL OUT"));
  expect(out.backgroundColor).toBe(T.tintOut);
  expect(out.borderTopWidth).toBe(2);
  expect(out.borderTopColor).toBe(T.rule);

  // The rule has to be its own color. Two points of the hairline's own
  // color is not a rule, it is a thicker hairline.
  expect(T.rule).not.toBe(T.border);

  // TOTAL IN is tinted the other way, like the web's.
  expect(styleOf(rowCell("TOTAL IN")).backgroundColor).toBe(T.tintIn);

  // ...and the rows being totaled are not.
  const rent = styleOf(rowCell("Rent"));
  expect(rent.backgroundColor).toBeUndefined();
  expect(rent.borderTopWidth).toBeUndefined();
});

test("every total row carries the rule, so the block has no gaps in it", async () => {
  await mount();
  for (const label of ["TOTAL IN", "TOTAL OUT", "MONTHLY NET", "CUMULATIVE NET"]) {
    expect(styleOf(rowCell(label)).borderTopWidth).toBe(2);
  }
});
