import { act, render, screen, userEvent, waitFor } from "@testing-library/react-native";
import { pickerProps } from "./setup";
import { fmtDate } from "../../src/shared/dates.ts";
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

test("the paycheck step asks when the next payday is, and uses it", async () => {
  // Setup used to assume today, which is wrong in both directions:
  // paid this morning and the money is already inside the balance on
  // a later step, so it gets counted twice; paid next Friday and
  // every projected date is off by a week.
  const got: SetupAnswers[] = [];
  await mount((a) => got.push(a));

  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  // The control reads MM/DD/YYYY, like every other date in the app.
  expect(screen.getByLabelText(new RegExp(`next payday\\?* ${fmtDate(iso).replace(/\//g, "\\/")}`))).toBeOnTheScreen();

  await userEvent.type(screen.getByLabelText("Amount"), "2100");
  await userEvent.press(screen.getByLabelText(new RegExp(`next payday`)));
  // The native picker cannot be driven here, so the change it would
  // have fired is fired directly — see pickerProps in setup.ts.
  const future = new Date(Date.now() + 9 * 86400000);
  await act(async () => {
    (pickerProps.current!.onChange as (e: unknown, d: Date) => void)({}, future);
  });

  // Continue, not Skip — skipping this step throws the paycheck away,
  // which is the whole point of Skip.
  await press("Continue");
  await skip(3);                            // rent, bills, groceries
  await userEvent.type(await screen.findByLabelText("Current balance"), "4000");
  await press("Continue");
  await press("Finish");
  await press("Go to my budget");

  const futureISO = future.toISOString().slice(0, 10);
  const pay = got[0]!.recurring![0]!;
  expect("cadence" in pay && pay.startDate).toBe(futureISO);
  // And the picker will not offer a date that has already gone.
  expect(pickerProps.current!.minimumDate).toBeInstanceOf(Date);
});

test("the keyboard cannot hide a control: every field reports its focus", async () => {
  // From a device: "the payday date field is below the fold with the
  // keypad up, and nothing shows it's there. I tried to tap it,
  // couldn't, then realized I had to scroll."
  //
  // The arithmetic is scrollToReveal, checked in
  // tests/mobile-setup.test.mjs. What can only be checked mounted is
  // that every field is actually wired to it, on every step — a
  // handler missing from one field is exactly how this comes back.
  await mount();

  const scroller = screen.getByTestId("setup-scroll");
  expect(scroller.props.automaticallyAdjustKeyboardInsets).toBe(true);
  expect(typeof scroller.props.onLayout).toBe("function");
  expect(typeof scroller.props.onScroll).toBe("function");

  const reports = (label: string) =>
    expect(typeof screen.getByLabelText(label).props.onFocus).toBe("function");

  reports("Amount");                                    // paycheck
  // The payday control is not a text field, so it cannot take focus —
  // it says it is a control instead, which is the other half of why
  // it was missed.
  expect(screen.getByText("Change ›")).toBeOnTheScreen();

  await press("Skip");
  reports("Amount");                                    // rent
  reports("Due on day");
  await press("Skip");
  reports("Bill 1 name");                               // bills
  reports("Bill 1 amount");
  reports("Bill 1 due day");
  await press("Skip");
  reports("Amount");                                    // groceries
  await press("Skip");
  reports("Current balance");                           // balance
  await userEvent.type(screen.getByLabelText("Current balance"), "4000");
  await press("Continue");
  reports("Savings 1 name");                            // accounts
  reports("Savings 1 amount");
});

test("every bill row's due day defaults to today, not to the row above", async () => {
  // THE BUG: "+ Add another bill" seeded the new row from bills[0].day,
  // so a second bill inherited whatever had just been typed into the
  // first — 8 if the first was set to the 8th, 4 if it was set to the
  // 4th — directly under a sentence saying it defaults to today.
  await mount();
  await press("Skip");                      // paycheck
  await press("Skip");                      // rent

  const today = new Date();
  const todayDay = String(today.getDate());

  const first = screen.getByLabelText("Bill 1 due day");
  expect(first.props.value).toBe(todayDay);
  // And it can be RETYPED. maxLength is 2 and the field arrives holding
  // two digits, so without selectTextOnFocus the first keypress is
  // swallowed and nothing happens at all.
  expect(first.props.selectTextOnFocus).toBe(true);

  await userEvent.clear(first);
  await userEvent.type(first, "8");
  expect(screen.getByLabelText("Bill 1 due day").props.value).toBe("8");

  await press("+ Add another bill");
  expect(screen.getByLabelText("Bill 2 due day").props.value).toBe(todayDay);
  // ...and the first row kept what was typed into it.
  expect(screen.getByLabelText("Bill 1 due day").props.value).toBe("8");
});

test("groceries ask which day of the week, and the rule starts on it", async () => {
  const got: SetupAnswers[] = [];
  await mount((a) => got.push(a));
  await press("Skip");                      // paycheck
  await press("Skip");                      // rent
  await press("Skip");                      // bills

  // Sunday is chosen on arrival — a step with nothing picked is a step
  // people skip, and Sunday is the common answer.
  expect(screen.getByLabelText("Sunday").props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText("Saturday").props.accessibilityState.selected).toBe(false);

  await userEvent.type(screen.getByLabelText("Amount"), "150");
  await userEvent.press(screen.getByLabelText("Saturday"));
  expect(screen.getByLabelText("Saturday").props.accessibilityState.selected).toBe(true);

  await press("Continue");
  await userEvent.type(await screen.findByLabelText("Current balance"), "4000");
  await press("Continue");
  await press("Finish");
  await press("Go to my budget");

  const groceries = got[0]!.recurring!.find((r) => r.name === "Groceries")!;
  const start = new Date(("startDate" in groceries ? groceries.startDate : "") + "T00:00:00");
  expect(start.getDay()).toBe(6);                       // a Saturday
  expect(start.getTime()).toBeGreaterThanOrEqual(new Date(new Date().toDateString()).getTime());
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
  const rent = answers.recurring![1]!;
  expect("cadence" in rent && rent.dayOfMonth).toBe(5);

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
