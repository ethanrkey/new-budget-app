import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import Setup from "../components/Setup";
import { applySetup } from "../../src/engine/setup.ts";
import { normalize } from "../../src/engine/stateShape.ts";
import type { SetupAnswers } from "../../src/engine/setup.ts";

// The six screens, mounted. What each step MEANS is in
// tests/mobile-setup.test.mjs and what it CREATES is in
// tests/setup.test.mjs, both of which run in milliseconds with no
// renderer. What only exists mounted is the sequence: does Continue
// move on, does Skip discard, does Back bring the typing back, and
// does the thing that finally reaches applySetup match what was on
// screen.
//
// TEXT FIELDS ARE DRIVEN WITH userEvent.type, never
// fireEvent.changeText. Two changeText calls against a controlled
// TextInput destroy the renderer — the test doing it passes and the
// NEXT test's render() returns null. Reproduced on a four-line
// component; see mobile/AGENTS.md.

/** Press a button once it is actually pressable. */
async function press(label: string) {
  const button = await screen.findByLabelText(label);
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.press(button);
}

/** Press Skip n times. The balance step has no Skip, so it is counted. */
async function skip(times: number) {
  for (let i = 0; i < times; i++) await press("Skip");
}

/** Skip the four optional questions and stop on the balance. */
const toBalance = () => skip(4);

/** ...and past it, which takes a number, because that step cannot be skipped. */
async function toAccounts(balance = "0") {
  await toBalance();
  await userEvent.type(screen.getByLabelText("Current balance"), balance);
  await press("Continue");
}

function mount(onComplete: (a: SetupAnswers) => void = () => {}, onSkip = () => {}) {
  return render(<Setup busy={false} onComplete={onComplete} onSkip={onSkip} />);
}

test("it opens on the first question and counts the rest", async () => {
  await mount();
  expect(screen.getByText("What's your take-home pay?")).toBeOnTheScreen();
  expect(screen.getByText("Step 1 of 6")).toBeOnTheScreen();
  // Nothing to go back to yet.
  expect(screen.queryByLabelText("Back")).toBeNull();
});

test("the phone's paycheck note points at a control the phone has", async () => {
  await mount();
  // The web's version of this sentence names Quick Entry, which the
  // phone does not have and is not getting. A platform variant, not a
  // second string: src/content/setup.ts.
  expect(screen.getByText(/\+ Add on the Ledger/)).toBeOnTheScreen();
  expect(screen.queryByText(/Quick Entry/)).toBeNull();
});

test("Continue keeps what was typed; Skip discards it", async () => {
  const got: SetupAnswers[] = [];
  await mount((a) => got.push(a));

  await userEvent.type(screen.getByLabelText("Amount"), "2100");
  await press("Continue");

  // Rent: type a number and then SKIP it. The rule must not exist.
  await userEvent.type(screen.getByLabelText("Amount"), "1450");
  await press("Skip");

  await press("Skip");                      // bills
  await press("Skip");                      // groceries
  await userEvent.type(screen.getByLabelText("Current balance"), "4000");
  await press("Continue");                  // balance
  await press("Finish");                    // accounts, untouched
  await press("Go to my budget");

  expect(got).toHaveLength(1);
  expect(got[0]!.recurring!.map((r) => r.name)).toEqual(["Paycheck"]);
  expect(got[0]!.checkInBalance).toBe(4000);
});

test("Back brings the typing back, and passing a step twice does not duplicate it", async () => {
  const got: SetupAnswers[] = [];
  await mount((a) => got.push(a));

  await userEvent.type(screen.getByLabelText("Amount"), "2100");
  await press("Continue");
  await press("Back");

  // The draft is held whole, so the field still has it — the web's
  // wizard could not do this at all.
  expect(screen.getByLabelText("Amount")).toHaveDisplayValue("2100");

  await press("Continue");
  await skip(3);                            // rent, bills, groceries
  await userEvent.type(screen.getByLabelText("Current balance"), "100");
  await press("Continue");
  await press("Finish");
  await press("Go to my budget");

  // ONE paycheck. Collecting into a list rather than keying by step
  // would have produced two.
  expect(got[0]!.recurring!.map((r) => r.name)).toEqual(["Paycheck"]);
});

test("the balance step cannot be passed, and says why", async () => {
  await mount();
  await toBalance();

  expect(screen.getByText("What's the balance of your primary checking account?")).toBeOnTheScreen();
  // No Skip on this step at all — every other question is optional and
  // this one cannot be.
  expect(screen.queryByLabelText("Skip")).toBeNull();
  expect(await screen.findByLabelText("Continue")).toBeDisabled();
  expect(screen.getByText(/even if it's 0/)).toBeOnTheScreen();

  // Zero IS an answer. An empty field is not.
  await userEvent.type(screen.getByLabelText("Current balance"), "0");
  await waitFor(() => expect(screen.getByLabelText("Continue")).toBeEnabled());
});

test("a half-filled account row blocks Finish and says which half", async () => {
  await mount();
  await toAccounts();

  // Untouched, the step finishes.
  expect(await screen.findByLabelText("Finish")).toBeEnabled();

  // An amount with no name is the bug a real user found: it used to be
  // silently dropped.
  await userEvent.type(screen.getByLabelText("Savings 1 amount"), "8200");
  await waitFor(() => expect(screen.getByLabelText("Finish")).toBeDisabled());
  expect(screen.getByText("Give this one a name, or clear the amount.")).toBeOnTheScreen();

  await userEvent.type(screen.getByLabelText("Savings 1 name"), "Ally");
  await waitFor(() => expect(screen.getByLabelText("Finish")).toBeEnabled());
});

test("what reaches applySetup is what was on the screen", async () => {
  const got: SetupAnswers[] = [];
  await mount((a) => got.push(a));

  await userEvent.type(screen.getByLabelText("Amount"), "2100");
  await press("Every 2 weeks");
  await press("Continue");

  await userEvent.type(screen.getByLabelText("Amount"), "1450");
  await userEvent.clear(screen.getByLabelText("Due on day"));
  await userEvent.type(screen.getByLabelText("Due on day"), "5");
  await press("Continue");

  await userEvent.type(screen.getByLabelText("Bill 1 name"), "Spotify");
  await userEvent.type(screen.getByLabelText("Bill 1 amount"), "11.99");
  await press("Continue");

  await userEvent.type(screen.getByLabelText("Amount"), "150");
  await press("Continue");

  await userEvent.type(screen.getByLabelText("Current balance"), "4000");
  await press("Continue");

  await userEvent.type(screen.getByLabelText("Savings 1 name"), "Ally");
  await userEvent.type(screen.getByLabelText("Savings 1 amount"), "8200");
  await userEvent.type(screen.getByLabelText("Debt 1 name"), "Car loan");
  await userEvent.type(screen.getByLabelText("Debt 1 amount"), "9100");
  await press("Finish");

  expect(screen.getByText(/We've added 4 recurring items/)).toBeOnTheScreen();
  await press("Go to my budget");

  const answers = got[0]!;
  expect(answers.recurring!.map((r) => r.name)).toEqual(["Paycheck", "Rent", "Spotify", "Groceries"]);
  expect(answers.recurring![1]!.dayOfMonth).toBe(5);

  // And the end of the chain: the same function the web calls.
  const out = applySetup(normalize({}), answers, "2026-10-13");
  expect(out.accounts[0]!.balance).toBe(4000);
  expect(out.trackerCategories.map((c) => c.name).sort()).toEqual(["Ally", "Car loan"]);
});

test("Skip setup leaves without creating anything", async () => {
  const skips: number[] = [];
  const got: SetupAnswers[] = [];
  await mount((a) => got.push(a), () => skips.push(1));

  await userEvent.type(screen.getByLabelText("Amount"), "2100");
  await press("Skip setup");

  expect(skips).toHaveLength(1);
  // Nothing is committed on the way out — the three-step guide is what
  // picks up from here, and it computes what is still missing itself.
  expect(got).toHaveLength(0);
});
