import { act, cleanup, render, screen, userEvent, waitFor, within } from "@testing-library/react-native";
import { T } from "../lib/theme";
import { haptics, pickerProps } from "./setup";
import { normalize } from "../../src/engine/stateShape.ts";
import { TOUR_STOPS } from "../../src/content/tour.ts";

// PHASE 3: who is met with the six questions, and what happens to the
// ones who leave.
//
// The predicate is tested without a renderer in
// tests/mobile-setup.test.mjs. What is here is the half that only
// exists mounted: is the flow actually in front of a new account, is
// it actually absent for everybody else, and does leaving it write the
// things that stop it coming back.

const blank = normalize({});
const seen = { ...blank, settings: { ...blank.settings, hasSeenOnboarding: true } };

// `mock` prefix: jest allows a module factory to reference it.
const mockLoaded: { state: unknown } = { state: blank };
// The shared stub in __tests__/setup.ts is always connected; this file
// needs to turn the network off, because offline is read-only and a
// control that invites a write it cannot make is worse than none.
const mockNet: { connected: boolean; listener: ((s: { isConnected: boolean }) => void) | null } =
  { connected: true, listener: null };
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: (fn: (s: { isConnected: boolean }) => void) => {
      mockNet.listener = fn;
      fn({ isConnected: mockNet.connected });
      return () => { mockNet.listener = null; };
    },
    fetch: async () => ({ isConnected: mockNet.connected }),
  },
}));
const mockSaved: unknown[] = [];

jest.mock("../lib/supabase", () => ({
  supabase: { auth: { signOut: jest.fn() }, from: jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) })) },
  BACKEND: "production",
  BACKEND_NOTICE: null,
}));
jest.mock("../lib/store", () => ({
  loadState: jest.fn(async () => mockLoaded.state),
  saveState: jest.fn(async (_id: string, s: unknown) => { mockSaved.push(s); return { ok: true }; }),
  resetStore: jest.fn(),
}));

const { StateProvider } = require("../components/StateProvider");
const { Chrome } = require("../components/Chrome");
const { Text } = require("react-native");

const session = { user: { id: "u1", email: "a@b.com", app_metadata: { providers: ["email"] }, created_at: "2026-10-01" } };

async function mount(userId = "u1") {
  await render(
    <StateProvider userId={userId}>
      <Chrome session={{ ...session, user: { ...session.user, id: userId } }}><Text>THE APP</Text></Chrome>
    </StateProvider>
  );
  // StateProvider blocks on the state load and the prefs read.
  await screen.findByText("THE APP");
}

/**
 * Walk the six questions and press through the Done screen.
 *
 * THE BALANCE IS FIRST and has no Skip, so it is answered before the
 * four that do — which is the shape of the flow since 2026-10-17.
 */
async function finishSetup(balance = "4000") {
  await userEvent.type(await screen.findByLabelText("Current balance"), balance);
  await userEvent.press(screen.getByLabelText("Continue"));
  for (const _ of [0, 1, 2, 3]) await userEvent.press(screen.getByLabelText("Skip"));
  await userEvent.press(screen.getByLabelText("Finish"));
  await userEvent.press(await screen.findByLabelText("Go to my budget"));
}

beforeEach(async () => {
  haptics.calls.length = 0;
  mockNet.connected = true;
  mockSaved.length = 0;
  mockLoaded.state = blank;
  const AsyncStorage = require("@react-native-async-storage/async-storage");
  await AsyncStorage.clear();
});

test("a brand-new account is met with the six questions", async () => {
  await mount();
  // The BALANCE first: the one answer the forecast cannot be built
  // without, and the one question everybody can answer.
  expect(await screen.findByText("What's the balance of your primary checking account?")).toBeOnTheScreen();
  expect(screen.getByText("Step 1 of 6")).toBeOnTheScreen();
});

test("an account that already did setup — on either client — is not asked again", async () => {
  // hasSeenOnboarding is ACCOUNT data, so the web's answer counts here.
  mockLoaded.state = seen;
  await mount();
  expect(screen.queryByText("What's the balance of your primary checking account?")).toBeNull();
});

test("Skip setup leaves, and marks the account so it does not come back", async () => {
  await mount();
  await userEvent.press(await screen.findByLabelText("Skip setup"));

  await waitFor(() => expect(screen.queryByText("What's the balance of your primary checking account?")).toBeNull());
  // The flag is account data and is written on the way out, so another
  // device does not ask again either.
  await waitFor(() => expect(mockSaved).toHaveLength(1));
  expect((mockSaved[0] as { settings: { hasSeenOnboarding: boolean } }).settings.hasSeenOnboarding).toBe(true);
  // And nothing was created, which is what Skip means.
  expect((mockSaved[0] as { recurring: unknown[] }).recurring).toEqual([]);
});

test("finishing writes the rules, the anchor and the flag in ONE save", async () => {
  await mount();
  await userEvent.type(await screen.findByLabelText("Current balance"), "4000");
  await userEvent.press(screen.getByLabelText("Continue"));

  await userEvent.type(screen.getByLabelText("Amount"), "2100");
  await userEvent.press(screen.getByLabelText("Continue"));
  for (const _ of [0, 1, 2]) await userEvent.press(screen.getByLabelText("Skip"));
  await userEvent.press(screen.getByLabelText("Finish"));
  await userEvent.press(await screen.findByLabelText("Go to my budget"));

  // ONE save. A half-applied setup — rules written, flag not, or the
  // other way round — must not be a state this app can be in.
  await waitFor(() => expect(mockSaved).toHaveLength(1));
  const out = mockSaved[0] as {
    settings: { hasSeenOnboarding: boolean; hasSeenTour: boolean };
    recurring: { name: string }[];
    accounts: { balance: number }[];
  };
  expect(out.recurring.map((r) => r.name)).toEqual(["Paycheck"]);
  expect(out.accounts[0]!.balance).toBe(4000);
  expect(out.settings.hasSeenOnboarding).toBe(true);
  // BOTH flags, in the same save. A setup that finished without
  // hasSeenTour set is an account that replays the tour the next time
  // Setup is opened from Settings, which is the build 11 report.
  expect(out.settings.hasSeenTour).toBe(true);
});

test("...and the tour comes up once, after the FIRST setup", async () => {
  await mount();
  await finishSetup();

  expect(await screen.findByText(TOUR_STOPS[0]!.title)).toBeOnTheScreen();
});

test("A NEW ACCOUNT ON A USED PHONE still gets setup, and then the tour", async () => {
  // THE BUG, reported from the owner's phone on 2026-10-17: two
  // brand-new accounts (+kbtest23, +kbtest84) landed straight on the
  // Ledger's three-step guide — no setup, no tour. The dismissal
  // written when the FIRST account on the phone finished was a bare
  // device boolean, so it answered for every account after it.
  //
  // AsyncStorage is NOT cleared between the two mounts here, exactly
  // as one phone's preference file is not cleared between two
  // sign-ins. That sharing is the whole point of the test.
  await mount("acct-a");
  await finishSetup();
  await waitFor(() => expect(mockSaved).toHaveLength(1));
  expect(await screen.findByText(TOUR_STOPS[0]!.title)).toBeOnTheScreen();
  await cleanup();   // async: unmounting account A is awaited, like a sign-out

  // Account B is brand new — its own settings say so — so the only
  // thing that could turn setup off for it is the device's answer.
  mockSaved.length = 0;
  mockLoaded.state = blank;
  await mount("acct-b");

  expect(await screen.findByText("What's the balance of your primary checking account?")).toBeOnTheScreen();
  await finishSetup("250");
  await waitFor(() => expect(mockSaved).toHaveLength(1));
  expect(await screen.findByText(TOUR_STOPS[0]!.title)).toBeOnTheScreen();
});

test("SIGNING OUT ENDS THIS DEVICE'S SESSION, not every session the user has", async () => {
  // THE BUG THIS EXISTS FOR, found in the Supabase auth log on
  // 2026-10-17: "400: Invalid Refresh Token: Refresh Token Not Found".
  // `supabase.auth.signOut()` defaults to `{ scope: 'global' }`, which
  // revokes every session this user has on every device — so an
  // afternoon of signing out on the phone to test other accounts was
  // an afternoon of silently killing the browser's session, which only
  // noticed on its next refresh up to an hour later. That is the whole
  // of "the web signs me out every so often and iOS doesn't".
  //
  // There is no way to notice the default by reading the call: one
  // with no argument looks finished.
  const { supabase } = require("../lib/supabase");
  supabase.auth.signOut.mockClear();
  mockLoaded.state = seen;
  await mount();
  await userEvent.press(await screen.findByLabelText("Settings, about and export"));
  await userEvent.press(await screen.findByLabelText("Sign out"));

  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  mockLoaded.state = blank;
});

test("Settings starts the tour in one tap, without going through About", async () => {
  // "About & tour" was ONE row that opened About, where the tour was a
  // button — so the row named two things and did one of them. Two
  // rows now, and this is the half that was two taps away.
  mockLoaded.state = { ...seen, settings: { ...seen.settings, hasSeenTour: true } };
  await mount();
  await userEvent.press(await screen.findByLabelText("Settings, about and export"));
  // The row is "Tour" since 2026-10-17; About's own button inside it
  // is still "Take the tour", which is a sentence rather than a label.
  await userEvent.press(await screen.findByLabelText("Tour"));

  expect(await screen.findByText(TOUR_STOPS[0]!.title)).toBeOnTheScreen();
  // Straight to the tour: About never came up on the way.
  expect(screen.queryByText("How this app works")).toBeNull();
  mockLoaded.state = blank;
});

test("...and About is its own row, which does not start anything", async () => {
  mockLoaded.state = { ...seen, settings: { ...seen.settings, hasSeenTour: true } };
  await mount();
  await userEvent.press(await screen.findByLabelText("Settings, about and export"));
  await userEvent.press(await screen.findByLabelText("About"));

  expect(await screen.findByText("How this app works")).toBeOnTheScreen();
  expect(screen.queryByText(TOUR_STOPS[0]!.title)).toBeNull();
  mockLoaded.state = blank;
});

test("...and NOT again when Setup is re-run from Settings", async () => {
  // THE BUG THIS WOULD HAVE CAUGHT, reported on build 11: the tour was
  // started by "a setup just finished" and nothing remembered it, so
  // re-running Setup from the header walked you round the app again.
  //
  // The flag is on the ACCOUNT, which is the other half of the report:
  // anything device-local would replay it on a new phone instead. So
  // this state is one that has finished setup before — exactly what a
  // returning account's rows say.
  mockLoaded.state = { ...seen, settings: { ...seen.settings, hasSeenTour: true } };
  await mount();
  await userEvent.press(await screen.findByLabelText("Settings, about and export"));
  await userEvent.press(await screen.findByLabelText("Set up your budget"));

  await finishSetup();

  await waitFor(() => expect(mockSaved).toHaveLength(1));
  // Straight back into the app.
  expect(screen.queryByText(TOUR_STOPS[0]!.title)).toBeNull();
  mockLoaded.state = blank;
});


// ---- the one thing about sign-in that can fail quietly ----------------

async function openSettings() {
  await userEvent.press(screen.getByLabelText("Settings, about and export"));
  return screen.findByText("Signed in as");
}

test("a half-linked Apple sign-in says so in Settings, in words", async () => {
  mockLoaded.state = seen;          // no setup flow over the top of it
  const AsyncStorage = require("@react-native-async-storage/async-storage");
  await AsyncStorage.setItem("budget-app-prefs-v1", JSON.stringify({ appleLinkFailed: true }));

  await mount();
  await openSettings();

  expect(screen.getByText("Apple sign-in isn't fully linked")).toBeOnTheScreen();
  // It must not read as "you are not signed in", because they are.
  expect(screen.getByText(/You are signed in and everything works/)).toBeOnTheScreen();
  // And it must say what to do, not just that something is wrong.
  expect(screen.getByText(/Sign out and sign in with Apple again/)).toBeOnTheScreen();
});

test("...and says nothing when there is nothing to say", async () => {
  mockLoaded.state = seen;
  await mount();
  await openSettings();
  expect(screen.queryByText("Apple sign-in isn't fully linked")).toBeNull();
});


test("the settings button ticks like a tab, because it is one", async () => {
  // Reported from build 9's device pass: every tab gives the
  // selection tick and the gear in the corner gave nothing, which
  // made the one navigation control outside the tab bar feel dead.
  //
  // The SAME feeling, not a new one — the vocabulary stays at five
  // words, and `selection` is already the one for "you moved between
  // discrete things" (lib/haptics.ts, and the tab bar's own
  // screenListeners in (tabs)/_layout.tsx).
  mockLoaded.state = seen;
  await mount();
  haptics.calls.length = 0;

  await userEvent.press(screen.getByLabelText("Settings, about and export"));
  // Nothing is ever ONLY a haptic: the screen it opens is the thing
  // you can see, and this is confirmation of it.
  expect(await screen.findByText("Settings")).toBeOnTheScreen();
  // Once, and the tab bar's word rather than a sixth one.
  expect(haptics.calls).toEqual(["selection"]);
});

// ---- the anchor is a door, on every tab ------------------------------

test("tapping the balance at the top opens the one Update balance sheet", async () => {
  mockLoaded.state = seen;
  await mount();

  // It is in Chrome, above the tabs, so this is true on all four —
  // logging the number every screen counts forward from used to mean
  // going to the Dashboard first.
  await userEvent.press(await screen.findByLabelText(/Checking .*Update the balance/));
  expect(await screen.findByText("Update Checking balance")).toBeOnTheScreen();
  // The same modal the Dashboard card opens, warning and all — a
  // second door, not a second way.
  expect(screen.getByText(/Transactions dated before this will drop out/)).toBeOnTheScreen();
});

test("the balance says it can be tapped, in muted gray, and says nothing offline", async () => {
  // It was tappable and gave no sign of it. The web has a plain
  // "Update balance" button; the phone had a line of text that
  // happened to respond. Build 8 gave it the words "Update ›" and
  // build 9 took them back for a pencil, because the words cost 62pt
  // on a strip that did not have them — see the test below.
  mockLoaded.state = seen;
  await mount();
  const cue = await screen.findByTestId("anchor-edit-cue");
  expect(cue).toBeOnTheScreen();
  expect(cue.props.name).toBe("pencil.circle");
  // Muted, NOT the brass accent. Gold is spent on the mark and on
  // money; an edit affordance for a reference figure is not the most
  // important thing on the screen.
  expect(cue.props.tintColor).toBe(T.dim);
  expect(cue.props.tintColor).not.toBe(T.brass);
  expect(screen.queryByText("Update ›")).toBeNull();

  // Offline is read-only everywhere else, so there is nothing to
  // invite — a cue that opens a form which cannot save is worse than
  // no cue at all.
  mockNet.connected = false;
  await act(async () => { mockNet.listener?.({ isConnected: false }); });
  expect(screen.queryByTestId("anchor-edit-cue")).toBeNull();
  mockNet.connected = true;
});

test("the checking bar hugs its content and cannot reach the settings button", async () => {
  // Reported from a device on build 11: at $4,500.00 the surface ran
  // the full width and left a wide empty right-hand side.
  //
  // jest cannot measure a layout, so this asserts the MECHANISM, the
  // way the two-line test below asserts a structure. Measured with
  // react-native-web at 390pt, which is where the mechanism came
  // from: `alignSelf: "flex-start"` on its own — the obvious
  // one-liner — hugs correctly at every normal balance and then
  // OVERFLOWS to 356pt in a 314pt slot on a long account name,
  // pushing the box 42pt under the settings button, because nothing
  // constrains a content-sized child. So the margins live on the slot
  // and the box is capped against it.
  mockLoaded.state = seen;
  await mount();

  const flat = (st: unknown): Record<string, unknown> =>
    Object.assign({}, ...[st].flat(Infinity).filter(Boolean) as object[]);

  // The slot owns the space, and lets its child be narrower than it.
  const slot = flat(screen.getByTestId("anchor-slot").props.style);
  expect(slot.alignItems).toBe("flex-start");
  expect(slot.marginRight).toBe(60);           // room for the settings button

  // The box is capped against the slot, and carries no horizontal
  // margin of its own — a margin here would put the cap and the edge
  // in different places, which is the bug.
  const boxStyle = screen.getByTestId("anchor-box").props.style;
  const boxed = flat(typeof boxStyle === "function" ? boxStyle({ pressed: false }) : boxStyle);
  expect(boxed.maxWidth).toBe("100%");
  expect(boxed.marginLeft).toBeUndefined();
  expect(boxed.marginRight).toBeUndefined();
});

test("the checking bar says AS OF, and never the word verified", async () => {
  // The owner's word, 2026-10-15. "Verified" is a claim about an act;
  // this line is saying when the number was true. The savings and
  // investment cards keep "logged", which IS an act you performed —
  // see the dashboard suite, which asserts that separately, so
  // changing one of the two words here cannot quietly change both.
  mockLoaded.state = seen;
  await mount();
  expect(await screen.findByText(/^as of /)).toBeOnTheScreen();
  expect(screen.queryByText(/verified/i)).toBeNull();
  // The screen reader hears the same sentence the eye reads.
  expect(await screen.findByLabelText(/Checking .*, as of .*Update the balance/)).toBeOnTheScreen();
});

test("the as-of date has its own line, so no balance can crowd it out", async () => {
  // THE BUG THIS WOULD HAVE CAUGHT. On a device, at a real balance of
  // $1,234.56, "verified 2026-10-14" was cut off. Everything sat on
  // one row — name, amount, date, "Update ›" — and the date was the
  // only thing carrying `flexShrink`, so the date was what gave way.
  //
  // Measured in SF Pro at the strip's own sizes, that row wanted
  // 316pt inside the 260pt the narrowest supported iPhone (the
  // 12/13 mini, 360pt wide, less 16pt margin, 60pt for the floating
  // settings button and 24pt of padding) gives it. No shrink rule
  // fixes 56pt of overflow; the line has to stop being shared.
  //
  // RE-MEASURED 2026-10-15 with the shorter word and the pencil, both
  // counted: 53 + 93.9 + 18 + 87.7 + 24 of gaps = 276.6 in 260. Still
  // 16.6pt over, so this is still two lines. Subtract everything that
  // is not the account name and one row leaves 36.4pt for it, which
  // the default name "Checking" overruns on its own at 53.
  //
  // So this does not assert a width, which jest cannot see. It
  // asserts the STRUCTURE that makes the width irrelevant: the date
  // is not on the row with the balance. Put it back on that row and
  // this fails, whatever flex properties it is given.
  mockLoaded.state = {
    ...seen,
    accounts: [{ ...seen.accounts[0]!, balance: 12345.67, balanceAsOf: "2026-10-14" }],
  };
  await mount();

  const dated = await screen.findByText("as of 10/14/2026");
  expect(dated).toBeOnTheScreen();
  // ...and its own Text is one unbroken string, not two runs that a
  // parent could have split.
  expect(within(screen.getByTestId("anchor-line")).queryByText(/as of/)).toBeNull();
  // The balance is the thing that grew, and it is on the other line.
  expect(within(screen.getByTestId("anchor-line")).getByText("$12,345.67")).toBeOnTheScreen();
  mockLoaded.state = seen;
});

test("...and writes the balance it was given", async () => {
  mockLoaded.state = seen;
  await mount();
  await userEvent.press(await screen.findByLabelText(/Checking .*Update the balance/));
  await userEvent.type(screen.getByPlaceholderText("0.00"), "4210.55");
  await userEvent.press(screen.getByLabelText("Confirm"));

  await waitFor(() => expect(mockSaved).toHaveLength(1));
  expect((mockSaved[0] as { accounts: { balance: number }[] }).accounts[0]!.balance).toBe(4210.55);
});


// ---- logging a balance that would hide rows --------------------------

/** A state with one row before Oct 10 and one after. */
function withRows() {
  const base = normalize({
    settings: { ledgerHorizon: "2026-12-31", budgetHorizon: "2026-12-31" },
    accounts: [{ id: "checking", name: "Checking", kind: "checking", balance: 1000, balanceAsOf: "2026-10-01", order: 0 }],
    trackerCategories: [],
    recurring: [],
    oneoffs: [
      { id: "o1", name: "Electric", amount: 120, category: "oneoff", date: "2026-10-03", order: 0 },
      { id: "o2", name: "Gym", amount: 40, category: "oneoff", date: "2026-12-20", order: 1 },
    ],
  });
  return { ...base, settings: { ...base.settings, hasSeenOnboarding: true } };
}

async function openLog() {
  await userEvent.press(await screen.findByLabelText(/Checking .*Update the balance/));
  await screen.findByText("Update Checking balance");
}

test("a balance that would hide rows names them before writing anything", async () => {
  mockLoaded.state = withRows();
  await mount();
  await openLog();

  await userEvent.type(screen.getByPlaceholderText("0.00"), "900");
  await userEvent.press(screen.getByLabelText("Confirm"));

  // Nothing is written yet — this is a question, not a report.
  expect(mockSaved).toHaveLength(0);
  expect(await screen.findByText("This will hide rows already in your ledger")).toBeOnTheScreen();
  // The row by name, date and amount, so it can be recognized.
  expect(screen.getByText("Electric")).toBeOnTheScreen();
  expect(screen.getByText("10/03/2026")).toBeOnTheScreen();
  // The row that survives is not listed.
  expect(screen.queryByText("Gym")).toBeNull();
  // And the way out for the case that costs money.
  expect(screen.getByText(/hiding it does not pay it/)).toBeOnTheScreen();

  await userEvent.press(screen.getByLabelText("Log balance"));
  await waitFor(() => expect(mockSaved).toHaveLength(1));
  expect((mockSaved[0] as { accounts: { balance: number }[] }).accounts[0]!.balance).toBe(900);
});

test("...and canceling writes nothing at all", async () => {
  mockLoaded.state = withRows();
  await mount();
  await openLog();
  await userEvent.type(screen.getByPlaceholderText("0.00"), "900");
  await userEvent.press(screen.getByLabelText("Confirm"));
  await screen.findByText("This will hide rows already in your ledger");

  await userEvent.press(screen.getByLabelText("Cancel"));
  expect(mockSaved).toHaveLength(0);
});

test("a log that hides nothing is not interrupted", async () => {
  // A warning shown when nothing would happen is noise, and noise is
  // how a warning stops being read. Today's date is after every row
  // here, so log AS OF the existing anchor date — nothing drops.
  mockLoaded.state = withRows();
  await mount();
  await openLog();

  // The sheet defaults to today; move it back to the current anchor.
  await userEvent.press(screen.getByLabelText(/As of .*Change the date/));
  await act(async () => {
    (pickerProps.current!.onChange as (e: unknown, d: Date) => void)({}, new Date("2026-10-01T00:00:00Z"));
  });
  await userEvent.type(screen.getByPlaceholderText("0.00"), "900");
  await userEvent.press(screen.getByLabelText("Confirm"));

  await waitFor(() => expect(mockSaved).toHaveLength(1));
  expect(screen.queryByText("This will hide rows already in your ledger")).toBeNull();
});
