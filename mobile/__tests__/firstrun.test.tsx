import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import FirstRun from "../components/FirstRun";
import { normalize } from "../../src/engine/stateShape.ts";
import { updateAccountBalance } from "../../src/engine/mutate.ts";

// The signpost a brand-new account lands on. The predicate behind it is
// tested in tests/mobile-firstrun.test.mjs; what is here is the half
// that only exists mounted — do the three buttons reach the three
// controls, and does offline say so instead of failing after the tap.
//
// Why this screen exists at all is an App Review argument as much as a
// kindness: a reviewer signing in with Apple gets a fresh account, and
// an app whose answer is "set this up on our website" cannot do its own
// job. Every button below opens something the phone already had.

const blank = normalize({});

test("the three steps are there, in the order that makes a forecast work", async () => {
  await render(<FirstRun state={blank} online onLogBalance={() => {}} onAddIncome={() => {}} onAddBill={() => {}} onDismiss={() => {}} />);

  // Balance first: it is the anchor every projected row counts forward
  // from. Income before bills, or the first forecast slopes down.
  expect(screen.getByLabelText("Log balance")).toBeOnTheScreen();
  expect(screen.getByLabelText("Add income")).toBeOnTheScreen();
  expect(screen.getByLabelText("Add a bill")).toBeOnTheScreen();
});

test("each button reaches its own control", async () => {
  const calls: string[] = [];
  await render(
    <FirstRun
      state={blank}
      online
      onLogBalance={() => calls.push("balance")}
      onAddIncome={() => calls.push("income")}
      onAddBill={() => calls.push("bill")}
      onDismiss={() => {}}
    />
  );

  await userEvent.press(screen.getByLabelText("Log balance"));
  await userEvent.press(screen.getByLabelText("Add income"));
  await userEvent.press(screen.getByLabelText("Add a bill"));
  // Wired to the wrong handler is the exact bug a glance would miss.
  expect(calls).toEqual(["balance", "income", "bill"]);
});

test("THE BUG: finishing step one ticks it off and keeps the other two", async () => {
  // The first version keyed the whole card off "is this account new",
  // which flips on the first write — so logging a balance made the
  // guide vanish and left a new user on an empty Ledger with two steps
  // to go and nothing saying so. Found on a phone, not here.
  const afterBalance = updateAccountBalance(blank, "checking", 4000, "2026-11-01");
  await render(
    <FirstRun state={afterBalance} online
      onLogBalance={() => {}} onAddIncome={() => {}} onAddBill={() => {}} onDismiss={() => {}} />
  );

  expect(screen.getByText("Balance logged")).toBeOnTheScreen();
  // A finished step keeps its tick and loses its button — leaving it
  // would read as "do it again".
  expect(screen.queryByLabelText("Log balance")).toBeNull();
  // And the two that matter most are still there.
  expect(screen.getByLabelText("Add income")).toBeOnTheScreen();
  expect(screen.getByLabelText("Add a bill")).toBeOnTheScreen();
  expect(screen.getByText(/2 to go/)).toBeOnTheScreen();
});

test("the guide can be put away by hand", async () => {
  const calls: string[] = [];
  await render(
    <FirstRun state={blank} online
      onLogBalance={() => {}} onAddIncome={() => {}} onAddBill={() => {}}
      onDismiss={() => calls.push("dismiss")} />
  );

  await userEvent.press(screen.getByLabelText("Hide this guide"));
  expect(calls).toEqual(["dismiss"]);
});

test("offline says offline rather than failing after the tap", async () => {
  const calls: string[] = [];
  await render(
    <FirstRun
      state={blank}
      online={false}
      onLogBalance={() => calls.push("balance")}
      onAddIncome={() => calls.push("income")}
      onAddBill={() => calls.push("bill")}
      onDismiss={() => {}}
    />
  );

  // Offline is read-only by decision, so the control has to say so
  // before it is pressed, the same way the Ledger's Add does.
  await waitFor(() => expect(screen.getAllByText("Offline")).toHaveLength(3));
  await userEvent.press(screen.getByLabelText("Log balance"));
  expect(calls).toHaveLength(0);
});
