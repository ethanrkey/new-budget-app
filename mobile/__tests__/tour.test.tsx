import { render, screen, userEvent } from "@testing-library/react-native";
import { TOUR_STOPS } from "../../src/content/tour.ts";

// WHERE THE TOUR PUTS YOU DOWN.
//
// The stops themselves are copy, and copy is in src/content/tour.ts
// where both clients read it. What only exists mounted is the
// ROUTING: which tab is behind each card, and — the thing build 9's
// device pass was about — which tab you are left on when it ends.
//
// Build 9 left you on the Dashboard, because that was the last stop
// and nothing moved you afterwards. The owner's note from his own
// first run: the Dashboard's value is not obvious right after setup,
// when it holds one reading of each account and no trend at all. So
// the tour starts on the Ledger and ends back on it, by every exit.

// Expo Router's imperative API, recorded. Tour calls `router.replace`
// and nothing else, so the list of routes IS the behavior under test.
// jest hoists the factory above this declaration, which is fine: the
// factory body does not run until the module is first required.
const routes: string[] = [];
jest.mock("expo-router", () => ({
  router: { replace: (r: string) => { routes.push(r); } },
}));

const Tour = require("../components/Tour").default;
const LEDGER = "/(tabs)";

beforeEach(() => { routes.length = 0; });

test("it opens on the Ledger and walks the stops in order", async () => {
  const onClose = jest.fn();
  await render(<Tour onClose={onClose} />);

  // The first stop routes before the first card is drawn, so the tab
  // underneath is already the one being described.
  expect(routes).toEqual([LEDGER]);
  expect(screen.getByText(TOUR_STOPS[0]!.title)).toBeOnTheScreen();

  await userEvent.press(screen.getByLabelText("Next"));
  await userEvent.press(screen.getByLabelText("Next"));
  await userEvent.press(screen.getByLabelText("Next"));
  expect(routes).toEqual([LEDGER, "/(tabs)/budget", "/(tabs)/spending", "/(tabs)/dashboard"]);
  expect(screen.getByLabelText("Done")).toBeOnTheScreen();
});

test("Done goes back to the Ledger, not wherever the last card was", async () => {
  const onClose = jest.fn();
  await render(<Tour onClose={onClose} />);
  for (let n = 1; n < TOUR_STOPS.length; n++) await userEvent.press(screen.getByLabelText("Next"));

  await userEvent.press(screen.getByLabelText("Done"));
  expect(routes[routes.length - 1]).toBe(LEDGER);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("...and so does Skip, from the middle of it", async () => {
  // The exit that is easiest to forget: quitting on Spending used to
  // leave you on Spending.
  const onClose = jest.fn();
  await render(<Tour onClose={onClose} />);
  await userEvent.press(screen.getByLabelText("Next"));
  await userEvent.press(screen.getByLabelText("Next"));
  expect(routes[routes.length - 1]).toBe("/(tabs)/spending");

  await userEvent.press(screen.getByLabelText("Skip the tour"));
  expect(routes[routes.length - 1]).toBe(LEDGER);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the Dashboard stop names the four things on the Dashboard", async () => {
  // "The Dashboard's value isn't obvious right after setup." The old
  // copy said what the screen is NOT and then named "net position",
  // which is a term you have to already know. DRAFT wording — the
  // owner finalizes it in the voice pass — but whatever it becomes,
  // it has to list what is actually on the screen.
  await render(<Tour onClose={() => {}} />);
  for (let n = 1; n < TOUR_STOPS.length; n++) await userEvent.press(screen.getByLabelText("Next"));

  const body = screen.getByText(TOUR_STOPS[TOUR_STOPS.length - 1]!.body);
  expect(body).toBeOnTheScreen();
  for (const word of ["checking", "savings", "investments", "debt"]) {
    expect(String(body.props.children).toLowerCase()).toContain(word);
  }
});
