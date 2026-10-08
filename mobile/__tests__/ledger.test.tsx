import { act, render, screen, userEvent } from "@testing-library/react-native";
import { pickerProps } from "./setup";
import { normalize } from "../../src/engine/stateShape.ts";

// A SECOND DISMISSAL PATH, which is what the one-modal fix did not cover.
//
// The Ledger's "through <date>" chip opens an inline DateTimePicker. It is
// not a Modal — on iOS `display="inline"` renders it straight into the
// component tree — so BottomSheet, which owns the single modal per screen,
// never saw it. And the bug is not a presentation race but a missing
// dismissal: `setPicking(Platform.OS === "ios")` evaluates to
// `setPicking(true)`, so choosing a date RE-OPENS it, and nothing else on
// the screen can ever set it false.
//
// These tests open it and then close it. Asserting that the chip exists
// would have passed the whole time it was broken.

// `mock` prefix: jest allows a module factory to reference it.
const mockState = normalize({
  settings: { budgetHorizon: "2027-04-01", ledgerHorizon: "2027-02-01" },
  accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 4000, balanceAsOf: "2026-10-01", order: 0 }],
  trackerCategories: [],
  recurring: [{ id: "r-rent", name: "Rent", amount: 1450, category: "bill", order: 0,
    cadence: "monthly", startDate: "2026-10-01", dayOfMonth: 1 }],
  oneoffs: [],
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

// Imported after the mocks, so the screen gets them.
const { StateProvider } = require("../components/StateProvider");
const LedgerScreen = require("../app/(tabs)/index").default;

const openLedger = async () => {
  await render(
    <StateProvider userId="u1">
      <LedgerScreen />
    </StateProvider>
  );
  // StateProvider blocks on the state load and the prefs read.
  await screen.findByText(/through/);
};

describe("the Ledger's horizon picker", () => {
  beforeEach(() => { pickerProps.current = null; });

  test("it is closed until the chip is tapped", async () => {
    await openLedger();
    expect(screen.queryByLabelText("Date picker")).toBeNull();
    await userEvent.press(screen.getByText(/through 2027-/));
    expect(screen.getByLabelText("Date picker")).toBeTruthy();
  });

  test("THE BUG: choosing a date closes it", async () => {
    await openLedger();
    await userEvent.press(screen.getByText(/through 2027-/));
    expect(screen.getByLabelText("Date picker")).toBeTruthy();

    // What the native picker fires when a date is chosen.
    await act(async () => {
      (pickerProps.current!.onChange as (e: unknown, d: Date) => void)({}, new Date("2027-03-01T00:00:00Z"));
    });

    expect(screen.queryByLabelText("Date picker")).toBeNull();
    expect(screen.getByText(/through 2027-03-01/)).toBeTruthy();
  });

  test("THE BUG: it can be dismissed WITHOUT choosing a date", async () => {
    await openLedger();
    await userEvent.press(screen.getByText(/through 2027-/));
    await userEvent.press(screen.getByLabelText("Done"));
    expect(screen.queryByLabelText("Date picker")).toBeNull();
    // and the horizon is unchanged
    expect(screen.getByText(/through 2027-02-01/)).toBeTruthy();
  });
});

// Every picker in the app is now the same component, so the guarantee
// holds everywhere rather than on the screen someone remembered.
describe("the one date picker", () => {
  beforeEach(() => { pickerProps.current = null; });

  test("Done closes it without changing the value", async () => {
    const onPick = jest.fn();
    const onClose = jest.fn();
    const DatePicker = require("../components/DatePicker").default;
    await render(<DatePicker value="2026-10-01" onPick={onPick} onClose={onClose} />);
    await userEvent.press(screen.getByLabelText("Done"));
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  test("choosing a date reports it AND closes", async () => {
    const onPick = jest.fn();
    const onClose = jest.fn();
    const DatePicker = require("../components/DatePicker").default;
    await render(<DatePicker value="2026-10-01" onPick={onPick} onClose={onClose} />);
    await act(async () => {
      (pickerProps.current!.onChange as (e: unknown, d: Date) => void)({}, new Date("2026-12-25T00:00:00Z"));
    });
    expect(onPick).toHaveBeenCalledWith("2026-12-25");
    expect(onClose).toHaveBeenCalled();
  });

  test("Android's own cancel closes without picking", async () => {
    const onPick = jest.fn();
    const onClose = jest.fn();
    const DatePicker = require("../components/DatePicker").default;
    await render(<DatePicker value="2026-10-01" onPick={onPick} onClose={onClose} />);
    await act(async () => {
      (pickerProps.current!.onChange as (e: unknown, d?: Date) => void)({ type: "dismissed" }, undefined);
    });
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
});
