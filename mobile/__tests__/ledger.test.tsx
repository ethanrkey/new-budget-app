import { act, render, screen, userEvent } from "@testing-library/react-native";
import { Alert } from "react-native";
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
    await userEvent.press(screen.getByText(/through \d\d\/\d\d\/2027/));
    expect(screen.getByLabelText("Date picker")).toBeTruthy();
  });

  test("THE BUG: choosing a date closes it", async () => {
    await openLedger();
    await userEvent.press(screen.getByText(/through \d\d\/\d\d\/2027/));
    expect(screen.getByLabelText("Date picker")).toBeTruthy();

    // What the native picker fires when a date is chosen.
    await act(async () => {
      (pickerProps.current!.onChange as (e: unknown, d: Date) => void)({}, new Date("2027-03-01T00:00:00Z"));
    });

    expect(screen.queryByLabelText("Date picker")).toBeNull();
    expect(screen.getByText("through 03/01/2027")).toBeTruthy();
  });

  test("THE BUG: it can be dismissed WITHOUT choosing a date", async () => {
    await openLedger();
    await userEvent.press(screen.getByText(/through \d\d\/\d\d\/2027/));
    await userEvent.press(screen.getByLabelText("Done"));
    expect(screen.queryByLabelText("Date picker")).toBeNull();
    // and the horizon is unchanged
    expect(screen.getByText("through 02/01/2027")).toBeTruthy();
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
    // BOTH SHAPES. The mutation audit found this test could not tell
    // the two guards apart: it only ever fired a dismissal with no
    // date, which the `!d` branch catches on its own, so deleting the
    // `type === "dismissed"` check killed nothing. The dismissal that
    // CARRIES a date is the one that check exists for — without it,
    // canceling an Android picker silently picks whatever the wheel
    // happened to be showing.
    const DatePicker = require("../components/DatePicker").default;

    for (const date of [undefined, new Date("2027-03-09T00:00:00Z")]) {
      const onPick = jest.fn();
      const onClose = jest.fn();
      await render(<DatePicker value="2026-10-01" onPick={onPick} onClose={onClose} />);
      await act(async () => {
        (pickerProps.current!.onChange as (e: unknown, d?: Date) => void)({ type: "dismissed" }, date);
      });
      expect(onClose).toHaveBeenCalled();
      expect(onPick).not.toHaveBeenCalled();
    }
  });
});

// ---- leaving a half-typed transaction --------------------------------
//
// The form takes most of the screen, so as of 2026-10-15 it can be
// dismissed by dragging it down as well as by Cancel, the scrim and
// the hardware back button. Four doors is three more chances to throw
// away a half-typed transaction by accident, so all four come through
// one guard — which is why the guard lives on the SCREEN and not in
// the sheet, and why it is tested here.
describe("closing the transaction form", () => {
  /** Alert.alert, captured with its buttons so a test can press one. */
  function captureAlert() {
    const seen: { title: string; body: string; buttons: { text?: string; onPress?: () => void }[] }[] = [];
    const spy = jest.spyOn(Alert, "alert").mockImplementation((title, body, buttons) => {
      seen.push({ title: String(title), body: String(body), buttons: (buttons ?? []) as never });
    });
    return { seen, restore: () => spy.mockRestore() };
  }

  const openAdd = async () => {
    await openLedger();
    await userEvent.press(screen.getByLabelText("Add transaction"));
    await screen.findByText("Add transaction");
  };

  test("an untouched form just closes — no prompt to learn to ignore", async () => {
    const { seen, restore } = captureAlert();
    await openAdd();
    await userEvent.press(screen.getByLabelText("Close"));
    expect(seen).toHaveLength(0);
    expect(screen.queryByLabelText("Name")).toBeNull();
    restore();
  });

  test("a form with something typed in it asks first, and Keep editing keeps it", async () => {
    const { seen, restore } = captureAlert();
    await openAdd();
    await userEvent.type(screen.getByLabelText("Name"), "Gym");
    await userEvent.press(screen.getByLabelText("Close"));

    expect(seen).toHaveLength(1);
    expect(seen[0]!.title).toBe("Discard changes?");
    // Nothing has happened yet: the sheet is still up and still holds
    // what was typed.
    expect(screen.getByLabelText("Name").props.value).toBe("Gym");
    restore();
  });

  test("...and Discard is what actually closes it", async () => {
    const { seen, restore } = captureAlert();
    await openAdd();
    await userEvent.type(screen.getByLabelText("Name"), "Gym");
    await userEvent.press(screen.getByLabelText("Close"));

    const discard = seen[0]!.buttons.find((b) => b.text === "Discard")!;
    expect(discard).toBeTruthy();
    await act(async () => { discard.onPress?.(); });
    expect(screen.queryByLabelText("Name")).toBeNull();
    restore();
  });

  test("Cancel goes through the same guard as the scrim does", async () => {
    // The whole reason the guard is on the screen rather than in the
    // sheet: a "Discard changes?" that only covers the button is not
    // a guard.
    const { seen, restore } = captureAlert();
    await openAdd();
    await userEvent.type(screen.getByLabelText("Name"), "Gym");
    await userEvent.press(screen.getByText("Cancel"));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.title).toBe("Discard changes?");
    restore();
  });
});
