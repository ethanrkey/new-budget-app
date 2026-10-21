import { act, render, screen, userEvent } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
describe("the scope sheet hands over to the editor, on the real screen", () => {
  // TWO HOSTS SINCE BUILD 9: the form is a system page sheet and the
  // scope sheet is still the bottom one, which puts the original
  // two-modal race back on exactly this transition. sheets.test.tsx
  // checks the same wiring on a copy of it; this one is the screen,
  // because a copy that has drifted proves nothing.
  test("picking 'edit every Rent' opens the editor once the scope sheet is gone", async () => {
    await openLedger();
    await userEvent.press(screen.getAllByLabelText(/^Rent, /)[0]!);
    expect(await screen.findByLabelText("Edit every Rent")).toBeOnTheScreen();

    // Held while the sheet is up, because that is what UIKit is
    // holding — and because under jest the Modal leaves the tree the
    // moment `visible` is false.
    const fire = screen.getByTestId("bottom-sheet").props.onDismiss as () => void;
    await userEvent.press(screen.getByLabelText("Edit every Rent"));

    // NOT YET. Presenting now is the bug: iOS swallows a modal
    // presented while another is still dismissing.
    expect(screen.queryByText("Edit Rent")).toBeNull();

    await act(async () => { fire(); });
    expect(screen.getByText("Edit Rent")).toBeOnTheScreen();
    expect(screen.getByTestId("native-sheet").props.presentationStyle).toBe("pageSheet");
  });
});

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

  /**
   * The swipe, as UIKit reports it.
   *
   * The form is a page sheet since build 9, so "swiped down" is not a
   * gesture this harness synthesizes — it is
   * `presentationControllerDidAttemptToDismiss` (when the sheet is
   * held) or `presentationControllerDidDismiss` (when it is not),
   * both of which RN surfaces as the Modal's `onRequestClose`.
   */
  const swipeDown = async () => {
    await act(async () => { screen.getByTestId("native-sheet").props.onRequestClose(); });
  };

  test("an untouched form just closes — no prompt to learn to ignore", async () => {
    const { seen, restore } = captureAlert();
    await openAdd();
    // ...and UIKit is told it may dismiss on its own, which is what
    // makes the gesture feel like every other sheet on the phone.
    expect(screen.getByTestId("native-sheet").props.allowSwipeDismissal).toBe(true);
    await swipeDown();
    expect(seen).toHaveLength(0);
    expect(screen.queryByLabelText("Name")).toBeNull();
    restore();
  });

  test("a form with something typed in it asks first, and Keep editing keeps it", async () => {
    const { seen, restore } = captureAlert();
    await openAdd();
    await userEvent.type(screen.getByLabelText("Name"), "Gym");

    // THE GUARD IS UIKIT'S, and it is armed BEFORE the gesture:
    // allowSwipeDismissal false is isModalInPresentation true, so the
    // sheet refuses to go and reports the attempt instead of sliding
    // away and having to be put back.
    expect(screen.getByTestId("native-sheet").props.allowSwipeDismissal).toBe(false);
    await swipeDown();

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
    await swipeDown();

    const discard = seen[0]!.buttons.find((b) => b.text === "Discard")!;
    expect(discard).toBeTruthy();
    await act(async () => { discard.onPress?.(); });
    expect(screen.queryByLabelText("Name")).toBeNull();
    restore();
  });

  test("Cancel goes through the same guard as the swipe does", async () => {
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

describe("whose guide it is", () => {
  // DISMISSAL IS PER ACCOUNT, ON THIS DEVICE. It was a bare boolean
  // until 2026-10-17, and the bug a tester hit was two new accounts
  // on one phone: the first put the guide away and the second was
  // never offered it. The fix keyed it by user id; nothing mounted
  // held the fix in place, and the mutation audit on 2026-10-21 put
  // `prefs.firstRunDismissedBy.length > 0` back with all 215
  // renderer tests still passing.
  // PUT BACK AFTERWARDS. AsyncStorage is one store for the whole
  // file, so a dismissal written here hides the guide from the test
  // after it — which is the same device-wide confusion this block is
  // about, one layer down.
  afterEach(async () => { await AsyncStorage.clear(); });

  const freshAccount = () => {
    const store = require("../lib/store");
    store.loadState.mockResolvedValueOnce(normalize({
      ...mockState,
      settings: { ...mockState.settings, hasSeenTour: false, askedAboutIncome: false },
    }));
  };

  test("someone else's dismissal on this phone does not hide it", async () => {
    await AsyncStorage.setItem("budget-app-prefs-v1",
      JSON.stringify({ firstRunDismissedBy: ["a-different-account"] }));
    freshAccount();
    await openLedger();
    expect(screen.getByText("Start here")).toBeOnTheScreen();
  });

  test("...and this account's own dismissal does", async () => {
    await AsyncStorage.setItem("budget-app-prefs-v1",
      JSON.stringify({ firstRunDismissedBy: ["a-different-account", "u1"] }));
    freshAccount();
    await openLedger();
    expect(screen.queryByText("Start here")).toBeNull();
  });
});

describe("the first-run guide's buttons open the right thing", () => {
  test("Add income opens the form on Income, not on One-off", async () => {
    // The guide is on this screen because the account has no income
    // rule, and its income button exists for exactly one purpose —
    // which it was undercutting by opening the form on One-off, the
    // default for a form nobody opened for anything. Asserted through
    // the SCREEN rather than against the sheet directly, because the
    // defect was in the wiring and the sheet was innocent.
    // This screen's usual fixture has already been asked about income
    // (its setup is marked finished), so the guide has nothing left to
    // ask and does not appear. One that has not been asked does.
    const store = require("../lib/store");
    store.loadState.mockResolvedValueOnce(normalize({
      ...mockState,
      settings: { ...mockState.settings, hasSeenTour: false, askedAboutIncome: false },
    }));
    await openLedger();
    await userEvent.press(screen.getByLabelText("Add income"));
    await screen.findByText("Add transaction");

    expect(screen.getByLabelText("Income").props.accessibilityState?.selected).toBe(true);
    expect(screen.getByLabelText("One-off").props.accessibilityState?.selected).toBe(false);
    // ...and nothing is red yet: the form was opened, not failed.
    expect(screen.queryByText("Give it a name.")).toBeNull();
  });
});
