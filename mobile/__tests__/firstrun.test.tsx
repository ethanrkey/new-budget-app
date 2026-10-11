import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import FirstRun from "../components/FirstRun";

// The signpost a brand-new account lands on. The predicate behind it is
// tested in tests/mobile-firstrun.test.mjs; what is here is the half
// that only exists mounted — do the three buttons reach the three
// controls, and does offline say so instead of failing after the tap.
//
// Why this screen exists at all is an App Review argument as much as a
// kindness: a reviewer signing in with Apple gets a fresh account, and
// an app whose answer is "set this up on our website" cannot do its own
// job. Every button below opens something the phone already had.

test("the three steps are there, in the order that makes a forecast work", async () => {
  await render(<FirstRun online onLogBalance={() => {}} onAddIncome={() => {}} onAddBill={() => {}} />);

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
      online
      onLogBalance={() => calls.push("balance")}
      onAddIncome={() => calls.push("income")}
      onAddBill={() => calls.push("bill")}
    />
  );

  await userEvent.press(screen.getByLabelText("Log balance"));
  await userEvent.press(screen.getByLabelText("Add income"));
  await userEvent.press(screen.getByLabelText("Add a bill"));
  // Wired to the wrong handler is the exact bug a glance would miss.
  expect(calls).toEqual(["balance", "income", "bill"]);
});

test("offline says offline rather than failing after the tap", async () => {
  const calls: string[] = [];
  await render(
    <FirstRun
      online={false}
      onLogBalance={() => calls.push("balance")}
      onAddIncome={() => calls.push("income")}
      onAddBill={() => calls.push("bill")}
    />
  );

  // Offline is read-only by decision, so the control has to say so
  // before it is pressed, the same way the Ledger's Add does.
  await waitFor(() => expect(screen.getAllByText("Offline")).toHaveLength(3));
  await userEvent.press(screen.getByLabelText("Log balance"));
  expect(calls).toHaveLength(0);
});
