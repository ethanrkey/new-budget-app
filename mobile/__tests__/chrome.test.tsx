import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import { normalize } from "../../src/engine/stateShape.ts";

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

async function mount() {
  await render(
    <StateProvider userId="u1">
      <Chrome session={session}><Text>THE APP</Text></Chrome>
    </StateProvider>
  );
  // StateProvider blocks on the state load and the prefs read.
  await screen.findByText("THE APP");
}

beforeEach(async () => {
  mockSaved.length = 0;
  mockLoaded.state = blank;
  const AsyncStorage = require("@react-native-async-storage/async-storage");
  await AsyncStorage.clear();
});

test("a brand-new account is met with the six questions", async () => {
  await mount();
  expect(await screen.findByText("What's your take-home pay?")).toBeOnTheScreen();
  expect(screen.getByText("Step 1 of 6")).toBeOnTheScreen();
});

test("an account that already did setup — on either client — is not asked again", async () => {
  // hasSeenOnboarding is ACCOUNT data, so the web's answer counts here.
  mockLoaded.state = seen;
  await mount();
  expect(screen.queryByText("What's your take-home pay?")).toBeNull();
});

test("Skip setup leaves, and marks the account so it does not come back", async () => {
  await mount();
  await userEvent.press(await screen.findByLabelText("Skip setup"));

  await waitFor(() => expect(screen.queryByText("What's your take-home pay?")).toBeNull());
  // The flag is account data and is written on the way out, so another
  // device does not ask again either.
  await waitFor(() => expect(mockSaved).toHaveLength(1));
  expect((mockSaved[0] as { settings: { hasSeenOnboarding: boolean } }).settings.hasSeenOnboarding).toBe(true);
  // And nothing was created, which is what Skip means.
  expect((mockSaved[0] as { recurring: unknown[] }).recurring).toEqual([]);
});

test("finishing writes the rules, the anchor and the flag in ONE save", async () => {
  await mount();
  await screen.findByText("What's your take-home pay?");

  await userEvent.type(screen.getByLabelText("Amount"), "2100");
  await userEvent.press(screen.getByLabelText("Continue"));
  for (const _ of [0, 1, 2]) await userEvent.press(screen.getByLabelText("Skip"));
  await userEvent.type(screen.getByLabelText("Current balance"), "4000");
  await userEvent.press(screen.getByLabelText("Continue"));
  await userEvent.press(screen.getByLabelText("Finish"));
  await userEvent.press(await screen.findByLabelText("Go to my budget"));

  // ONE save. A half-applied setup — rules written, flag not, or the
  // other way round — must not be a state this app can be in.
  await waitFor(() => expect(mockSaved).toHaveLength(1));
  const out = mockSaved[0] as {
    settings: { hasSeenOnboarding: boolean };
    recurring: { name: string }[];
    accounts: { balance: number }[];
  };
  expect(out.recurring.map((r) => r.name)).toEqual(["Paycheck"]);
  expect(out.accounts[0]!.balance).toBe(4000);
  expect(out.settings.hasSeenOnboarding).toBe(true);
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

test("...and writes the balance it was given", async () => {
  mockLoaded.state = seen;
  await mount();
  await userEvent.press(await screen.findByLabelText(/Checking .*Update the balance/));
  await userEvent.type(screen.getByPlaceholderText("0.00"), "4210.55");
  await userEvent.press(screen.getByLabelText("Confirm"));

  await waitFor(() => expect(mockSaved).toHaveLength(1));
  expect((mockSaved[0] as { accounts: { balance: number }[] }).accounts[0]!.balance).toBe(4210.55);
});
