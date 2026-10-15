import { act, render, screen, userEvent, waitFor } from "@testing-library/react-native";
import { dayPickerProps, pickerProps } from "./setup";
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

/**
 * The due-day row for a question, by the label it carries.
 *
 * Since build 9 this is a Pressable, not a TextInput: it announces
 * itself as "<label> <day>. Change the day." so VoiceOver says what
 * it shows AND that it can be changed, which is the whole point of
 * the pattern. Matching on the prefix is what lets a test ask for the
 * row without restating the day it currently holds.
 */
const dayRow = (label: string) => screen.getByLabelText(new RegExp(`^${label} \\d+\\. Change the day\\.$`));
const dayOn = (label: string) => dayRow(label).props.accessibilityLabel.match(/ (\d+)\. /)![1];

/**
 * Turn the wheel the way a finger would, then press Done.
 *
 * DONE IS NOT OPTIONAL, since build 9's device pass. The wheel used
 * to commit and close on settle, which is a date picker's behavior
 * and wrong for a wheel: coasting past a number is not choosing it.
 */
async function pickDay(label: string, day: number) {
  await userEvent.press(dayRow(label));
  expect(screen.getByLabelText("Day picker")).toBeOnTheScreen();
  await act(async () => {
    (dayPickerProps.current!.onValueChange as (v: number) => void)(day);
  });
  await userEvent.press(screen.getByLabelText("Done"));
}

/** Open a first-contribution row and choose a date `days` out. */
async function pickFirst(label: string, days: number) {
  const row = screen.getByLabelText(new RegExp(`^${label} .*Change the date\\.$`));
  await userEvent.press(row);
  const when = new Date();
  when.setDate(when.getDate() + days);
  await act(async () => {
    (pickerProps.current!.onChange as (e: unknown, d: Date) => void)(
      { type: "set" }, new Date(when.toISOString().slice(0, 10) + "T12:00:00"),
    );
  });
  return when.toISOString().slice(0, 10);
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
  // The due day is a picker row rather than a field, so like the
  // payday control it cannot take focus — it says it is a control.
  expect(dayRow("What day of the month is your rent due\\?")).toBeOnTheScreen();
  await press("Skip");
  reports("Bill 1 name");                               // bills
  reports("Bill 1 amount");
  expect(dayRow("Bill 1 due day")).toBeOnTheScreen();
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

  expect(dayOn("Bill 1 due day")).toBe(todayDay);

  await pickDay("Bill 1 due day", 8);
  expect(dayOn("Bill 1 due day")).toBe("8");

  await press("+ Add another bill");
  expect(dayOn("Bill 2 due day")).toBe(todayDay);
  // ...and the first row kept what was chosen in it.
  expect(dayOn("Bill 1 due day")).toBe("8");
});

test("the due day is picked from 1-31, and there is no way to type 50", async () => {
  // THE BUG, from the build 8 device pass: the due day was a
  // two-character number pad field and you could enter 50. The engine
  // clamped it to 31 (tests/setup.test.mjs proves it still does) and
  // said nothing, so the field quietly meant something other than
  // what was in it.
  //
  // The fix is a control that cannot express 50, which is also why
  // this asserts there is no text input left to type into: a picker
  // added BESIDE the old field would pass every other check here.
  await mount();
  await press("Skip");                      // paycheck

  // Rent's label is a question now. "Due on day" beside a number box
  // was a column heading; above a row that already shows a day it
  // reads as something already answered.
  const rent = "What day of the month is your rent due\\?";
  expect(screen.getByText("What day of the month is your rent due?")).toBeOnTheScreen();
  expect(screen.queryByText("Due on day")).toBeNull();

  // Closed until asked for.
  expect(screen.queryByLabelText("Day picker")).toBeNull();
  // And the day is not in a text field. `queryAllByDisplayValue` only
  // ever finds a TextInput, so this fails the moment a typeable day
  // exists — including a picker added BESIDE the old field, which
  // every other assertion here would happily pass.
  expect(dayOn(rent)).toBe("1");
  expect(screen.queryAllByDisplayValue("1")).toHaveLength(0);

  await pickDay(rent, 31);
  expect(dayOn(rent)).toBe("31");
  expect(screen.queryAllByDisplayValue("31")).toHaveLength(0);
  // ...and Done closed it.
  expect(screen.queryByLabelText("Day picker")).toBeNull();

  // 31 is as far as the wheel goes: the options are 1..31 and nothing
  // else, so 50 is not a value this control can produce.
  const items = (dayPickerProps.current!.children as { props: { value: number } }[]);
  expect(items).toHaveLength(31);
  expect(items[0]!.props.value).toBe(1);
  expect(items[30]!.props.value).toBe(31);
});

test("the day wheel commits on Done and on nothing else", async () => {
  // THE BUG THIS WOULD HAVE CAUGHT, reported from the build 9 device
  // pass: the wheel committed whenever it stopped scrolling, and
  // closed itself doing it. A UIPickerView reports the row it coasts
  // to a stop on, so flicking past the 14th on the way to the 20th
  // set the 14th and shut the picker — and the only way back was to
  // reopen it and try to land more precisely.
  //
  // Three claims, and the second and third are the ones that were
  // broken: turning the wheel changes nothing, Done commits what the
  // wheel is showing, and Cancel leaves the old value alone.
  await mount();
  await press("Skip");                      // paycheck
  const rent = "What day of the month is your rent due\\?";

  // 1. The wheel moves and the row does not.
  await userEvent.press(dayRow(rent));
  await act(async () => {
    (dayPickerProps.current!.onValueChange as (v: number) => void)(14);
  });
  expect(dayOn(rent)).toBe("1");
  expect(screen.getByLabelText("Day picker")).toBeOnTheScreen();

  // 2. Cancel throws the draft away, and the row still says 1.
  await userEvent.press(screen.getByLabelText("Cancel"));
  expect(screen.queryByLabelText("Day picker")).toBeNull();
  expect(dayOn(rent)).toBe("1");

  // 3. Reopened, the wheel starts from the committed value rather
  //    than from the draft that was abandoned — otherwise Cancel
  //    only looks like it worked.
  await userEvent.press(dayRow(rent));
  expect(dayPickerProps.current!.selectedValue).toBe(1);

  // 4. And Done commits.
  await act(async () => {
    (dayPickerProps.current!.onValueChange as (v: number) => void)(20);
  });
  await userEvent.press(screen.getByLabelText("Done"));
  expect(dayOn(rent)).toBe("20");
});

describe("every row in setup has an \u2715, and the list is never left empty", () => {
  // TWO DEVICE PASSES GOT THIS WRONG IN OPPOSITE DIRECTIONS.
  //
  // Build 8: "+ Add another bill" rows could not be removed at all on
  // the phone. Build 9 answered that with a left-swipe on PanResponder
  // — native-looking, and on the owner's phone "extremely buggy, I can
  // barely get it to peek out", because a hand-rolled horizontal
  // gesture has to win a responder negotiation against the ScrollView
  // it lives in. It also only ever covered the bills step; the three
  // account groups could be added to and never pruned.
  //
  // So: no gesture, an \u2715 on every row of both lists, and the same
  // engine rule behind each — removing the last row leaves one blank
  // one rather than none.

  async function threeBills() {
    await mount();
    await press("Skip");                    // paycheck
    await press("Skip");                    // rent
    await userEvent.type(screen.getByLabelText("Bill 1 name"), "Spotify");
    await press("+ Add another bill");
    await userEvent.type(screen.getByLabelText("Bill 2 name"), "Gym");
    await press("+ Add another bill");
    await userEvent.type(screen.getByLabelText("Bill 3 name"), "HBO");
  }

  test("the \u2715 removes a bill row, and the rest close up", async () => {
    await threeBills();
    await userEvent.press(screen.getByLabelText("Remove bill 2"));

    expect(screen.getByLabelText("Bill 1 name").props.value).toBe("Spotify");
    expect(screen.getByLabelText("Bill 2 name").props.value).toBe("HBO");
    expect(screen.queryByLabelText("Bill 3 name")).toBeNull();
  });

  test("...and it is on EVERY bill row, including the blank one", async () => {
    // Not "past the first": a control that appears at two rows is one
    // nobody finds when they need it at one.
    await mount();
    await press("Skip");                    // paycheck
    await press("Skip");                    // rent
    expect(screen.getByLabelText("Remove bill 1")).toBeOnTheScreen();
    await press("+ Add another bill");
    expect(screen.getByLabelText("Remove bill 1")).toBeOnTheScreen();
    expect(screen.getByLabelText("Remove bill 2")).toBeOnTheScreen();
  });

  test("removing the last bill row leaves one empty row, not none", async () => {
    await mount();
    await press("Skip");                    // paycheck
    await press("Skip");                    // rent
    await userEvent.type(screen.getByLabelText("Bill 1 name"), "Spotify");

    await userEvent.press(screen.getByLabelText("Remove bill 1"));
    // Still a row, and it is blank — the same row the step opens with,
    // due day included.
    expect(screen.getByLabelText("Bill 1 name").props.value).toBe("");
    expect(dayOn("Bill 1 due day")).toBe(String(new Date().getDate()));
  });

  test("the account groups have one too, on all three", async () => {
    // The step the swipe never reached at all.
    await mount();
    await toAccounts();
    for (const group of ["investments", "savings", "debt"]) {
      expect(screen.getByLabelText(`Remove ${group} row 1`)).toBeOnTheScreen();
    }

    await userEvent.type(screen.getByLabelText("Savings 1 name"), "Emergency fund");
    await userEvent.type(screen.getByLabelText("Savings 1 amount"), "8200");
    await press("+ Add another savings");
    await userEvent.type(screen.getByLabelText("Savings 2 name"), "Vacation");
    await userEvent.type(screen.getByLabelText("Savings 2 amount"), "500");

    await userEvent.press(screen.getByLabelText("Remove savings row 1"));
    expect(screen.getByLabelText("Savings 1 name").props.value).toBe("Vacation");
    expect(screen.queryByLabelText("Savings 2 name")).toBeNull();
    // The other two groups were not touched.
    expect(screen.getByLabelText("Investments 1 name").props.value).toBe("");
    expect(screen.getByLabelText("Debt 1 name").props.value).toBe("");
  });

  test("removing the last row of a group leaves one blank row there too", async () => {
    await mount();
    await toAccounts();
    // HALF-FILLED, which is the state that blocks the step. Clearing
    // the row is the other half of why this control exists: before
    // it, the only way past a row you had started by mistake was to
    // select the text in it and delete it by hand.
    await userEvent.type(screen.getByLabelText("Debt 1 name"), "Car loan");
    await waitFor(() => expect(screen.getByLabelText("Finish")).toBeDisabled());
    expect(screen.getByText("Add the balance, or clear the name.")).toBeOnTheScreen();

    await userEvent.press(screen.getByLabelText("Remove debt row 1"));
    expect(screen.getByLabelText("Debt 1 name").props.value).toBe("");
    expect(screen.getByLabelText("Debt 1 amount").props.value).toBe("");
    await waitFor(() => expect(screen.getByLabelText("Finish")).toBeEnabled());
  });
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

test("the accounts step lists investments first, and names no bank", async () => {
  // Owner's call from build 9's device pass: investments above
  // savings, then debt. Asserted as the ORDER ON SCREEN rather than
  // as the contents of ACCOUNT_GROUPS, which would only be the
  // constant checked against itself. The engine's own collection
  // order is held to the same list in tests/setup.test.mjs, so the
  // categories come out the way the step asked.
  await mount();
  await toAccounts();
  expect(
    screen.getAllByText(/^(Investments|Savings|Debt)$/).map((n) => n.props.children)
  ).toEqual(["Investments", "Savings", "Debt"]);

  // AND NO PLACEHOLDER NAMES A BANK. Savings said "e.g. Everbank",
  // which is the owner's own — a real institution's name in a shipped
  // app that has nothing to do with it, suggesting where to keep the
  // money rather than what to call it.
  expect(screen.getByLabelText("Savings 1 name").props.placeholder).toBe("e.g. Emergency fund");
  expect(screen.queryByPlaceholderText(/Everbank/i)).toBeNull();
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

  // Finishing the row unblocks the step — and turns the button into
  // Continue, because a finished account is something the
  // contributions step can ask about and that step is now there.
  await userEvent.type(screen.getByLabelText("Savings 1 name"), "Ally");
  await waitFor(() => expect(screen.getByLabelText("Continue")).toBeEnabled());
  expect(screen.queryByLabelText("Finish")).toBeNull();
  expect(screen.getByText("Step 6 of 7")).toBeOnTheScreen();
});

test("what reaches applySetup is what was on the screen", async () => {
  const got: SetupAnswers[] = [];
  await mount((a) => got.push(a));

  await userEvent.type(screen.getByLabelText("Amount"), "2100");
  await press("Every 2 weeks");
  await press("Continue");

  await userEvent.type(screen.getByLabelText("Amount"), "1450");
  await pickDay("What day of the month is your rent due\\?", 5);
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
  // Two finished accounts, so the contributions step is now in the
  // flow and the accounts step's button is Continue.
  await press("Continue");
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

test("the contributions step is not there when there is nothing to ask about", async () => {
  // A step listing nothing makes the flow look longer than it is.
  await mount();
  await toAccounts();
  expect(screen.getByText("Step 6 of 6")).toBeOnTheScreen();
  expect(await screen.findByLabelText("Finish")).toBeEnabled();
});

test("a contribution becomes a recurring rule in that account's category", async () => {
  const got: SetupAnswers[] = [];
  await mount((a) => got.push(a));
  await toAccounts("4000");

  await userEvent.type(screen.getByLabelText("Savings 1 name"), "Ally");
  await userEvent.type(screen.getByLabelText("Savings 1 amount"), "8200");
  await userEvent.type(screen.getByLabelText("Debt 1 name"), "Car loan");
  await userEvent.type(screen.getByLabelText("Debt 1 amount"), "9100");
  await press("Continue");

  // Both accounts are listed, and the words differ by what they are.
  expect(screen.getByText("Into Ally")).toBeOnTheScreen();
  expect(screen.getByText("Toward Car loan")).toBeOnTheScreen();

  // Answer for one and leave the other blank. A blank row is a
  // skipped question, not a zero.
  await userEvent.type(screen.getByLabelText("Ally contribution amount"), "300");
  const first = await pickFirst("Ally first contribution", 7);
  await press("Finish");
  await press("Go to my budget");

  const accounts = got[0]!.accounts!;
  expect(accounts.map((a) => a.name)).toEqual(["Ally", "Car loan"]);
  expect(accounts[0]!.contribution).toEqual({ amount: 300, cadence: "monthly", start: first });
  expect(accounts[1]!.contribution).toBeUndefined();

  // ...and the end of the chain: a real rule, pointed at the category
  // that account became, starting on the date that was picked rather
  // than on the day setup happened to be run.
  const out = applySetup(normalize({}), got[0]!, "2026-10-13");
  const ally = out.trackerCategories.find((c) => c.name === "Ally")!;
  const rule = out.recurring.find((r) => r.name === "Ally")!;
  expect(rule.category).toBe(ally.id);
  expect(rule.amount).toBe(300);
  expect("cadence" in rule && rule.startDate).toBe(first);
  expect("cadence" in rule && rule.dayOfMonth).toBe(Number(first.slice(8)));
  // Nothing was invented for the account that was left blank.
  expect(out.recurring.some((r) => r.name.includes("Car loan"))).toBe(false);
});

test("Skip on the contributions step discards what was typed into it", async () => {
  const got: SetupAnswers[] = [];
  await mount((a) => got.push(a));
  await toAccounts("4000");
  await userEvent.type(screen.getByLabelText("Savings 1 name"), "Ally");
  await userEvent.type(screen.getByLabelText("Savings 1 amount"), "8200");
  await press("Continue");

  await userEvent.type(screen.getByLabelText("Ally contribution amount"), "300");
  await press("Skip");
  await press("Go to my budget");

  // The account survives — it was answered on the step before — and
  // the contribution does not.
  expect(got[0]!.accounts!.map((a) => a.name)).toEqual(["Ally"]);
  expect(got[0]!.accounts![0]!.contribution).toBeUndefined();
});

test("every cadence asks when the first contribution is", async () => {
  // IT USED TO ASK ONLY FOR A MONTHLY ONE, as a day of the month, so
  // weekly and biweekly contributions silently started on the day
  // setup was run — the same date as the balance the step before it
  // asked for, which counts the first transfer twice. The paycheck
  // step learned this already; this is the last step that had it.
  await mount();
  await toAccounts("4000");
  await userEvent.type(screen.getByLabelText("Savings 1 name"), "Ally");
  await userEvent.type(screen.getByLabelText("Savings 1 amount"), "8200");
  await press("Continue");

  const row = () => screen.getByLabelText(/^Ally first contribution .*Change the date\.$/);
  expect(screen.getByText("First contribution")).toBeOnTheScreen();
  expect(row()).toBeOnTheScreen();
  for (const cadence of ["Every week", "Every 2 weeks", "Every month"]) {
    await userEvent.press(screen.getByLabelText(cadence));
    expect(row()).toBeOnTheScreen();
  }
  // And no day-of-month control anywhere on the step.
  expect(screen.queryByText("Payment day")).toBeNull();
});

test("a debt row asks for the first PAYMENT, which is the word for it", async () => {
  await mount();
  await toAccounts("4000");
  await userEvent.type(screen.getByLabelText("Debt 1 name"), "Car loan");
  await userEvent.type(screen.getByLabelText("Debt 1 amount"), "9100");
  await press("Continue");
  expect(screen.getByText("First payment")).toBeOnTheScreen();
  expect(screen.queryByText("First contribution")).toBeNull();
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
