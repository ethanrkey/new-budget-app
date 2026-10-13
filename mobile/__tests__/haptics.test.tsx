import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { haptics, authCalls } from "./setup";
import HistoryList from "../components/HistoryList";
import SignIn from "../components/SignIn";
import { normalize } from "../../src/engine/stateShape.ts";

// The only part of this app that leaves no trace on a screen.
//
// A haptic cannot be seen in a simulator, cannot be screenshotted and
// cannot be checked by looking at the phone. So the calls are
// recorded, and what is asserted is the two things that actually go
// wrong: firing at the wrong MOMENT, and firing too often.
//
// THE STANDING RULE IS NOT TESTED HERE BECAUSE IT CANNOT BE: "nothing
// may be only a haptic" is a claim about what else is on screen, and
// every assertion below sits next to one about an alert, an error
// line or a changed value for exactly that reason.

const blank = normalize({});
const mockLoaded = { state: blank };
const mockSaved: unknown[] = [];

jest.mock("../lib/store", () => ({
  loadState: jest.fn(async () => mockLoaded.state),
  saveState: jest.fn(async (_id: string, s: unknown) => { mockSaved.push(s); return { ok: true }; }),
  resetStore: jest.fn(),
}));

const { StateProvider } = require("../components/StateProvider");
const { Chrome } = require("../components/Chrome");
const { Text } = require("react-native");
const session = { user: { id: "u1", email: "a@b.com", app_metadata: { providers: ["email"] }, created_at: "2026-10-01" } };

beforeEach(() => {
  haptics.calls.length = 0;
  mockSaved.length = 0;
  authCalls.verify.length = 0;
  authCalls.nextVerifyError = null;
});

const SNAPSHOT = { id: "s1", date: "2026-10-01", amount: 1200 };

test("the warning comes BEFORE the confirm, not after the deletion", async () => {
  const alerts: string[] = [];
  const spy = jest.spyOn(Alert, "alert").mockImplementation((title) => { alerts.push(String(title)); });

  await render(
    <HistoryList entries={[SNAPSHOT]} online onEdit={() => {}} onDelete={() => {}} />
  );
  await userEvent.press(screen.getByText(/Show history/));
  await userEvent.press(screen.getByLabelText(/Delete the reading/));

  // By the time something is gone, a warning is late. The moment worth
  // marking is the one where the phone is asking you to stop and read
  // — so the buzz is already spent when the alert arrives.
  expect(haptics.calls).toEqual(["warning"]);
  expect(alerts).toEqual(["Delete this reading?"]);
  spy.mockRestore();
});

test("a wrong code fails, a right one succeeds, and neither fires per keystroke", async () => {
  await render(<SignIn />);
  await userEvent.type(screen.getByPlaceholderText("you@example.com"), "ethan@example.com");
  await userEvent.press(await screen.findByLabelText("Email me a code"));
  const field = await screen.findByPlaceholderText("000000");
  haptics.calls.length = 0;

  authCalls.nextVerifyError = { message: "Token has expired or is invalid", status: 403 };
  await userEvent.type(field, "123456");
  // Six digits typed, ONE buzz. Not six — a phone with an opinion
  // about every digit is a phone to turn off.
  await waitFor(() => expect(haptics.calls).toEqual(["error"]));
  // Said on screen too, which is the rule: the buzz is never the only
  // report of anything.
  expect(screen.getByText(/that code/i)).toBeOnTheScreen();

  haptics.calls.length = 0;
  await userEvent.clear(field);
  await userEvent.paste(field, "654321");
  await waitFor(() => expect(haptics.calls).toEqual(["success"]));
});

test("one write is felt once, however many screens it took", async () => {
  await render(
    <StateProvider userId="u1">
      <Chrome session={session}><Text>THE APP</Text></Chrome>
    </StateProvider>
  );
  // A blank account is met with setup; finishing it is one commit.
  await screen.findByText("What's your take-home pay?");
  haptics.calls.length = 0;

  // Four skips: paycheck, rent, bills, groceries. The balance step has
  // no Skip, which is the point of it.
  for (const _ of [0, 1, 2, 3]) await userEvent.press(screen.getByLabelText("Skip"));
  await userEvent.type(await screen.findByLabelText("Current balance"), "4000");
  await userEvent.press(screen.getByLabelText("Continue"));
  await userEvent.press(screen.getByLabelText("Finish"));
  await userEvent.press(await screen.findByLabelText("Go to my budget"));

  await waitFor(() => expect(mockSaved).toHaveLength(1));
  // ONE success for one write, however many screens it took to get here.
  expect(haptics.calls).toEqual(["success"]);
});
