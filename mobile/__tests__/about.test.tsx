import { render, screen, userEvent } from "@testing-library/react-native";
import About from "../components/About";
import { ABOUT_SECTIONS } from "../../src/content/about.ts";

// The About screen's tab row, which shipped broken because it was never
// pressed on a device: the pills ballooned into ovals and circles whose
// height changed with whichever section was open, and the chosen tab was
// left half off the right edge.
//
// Both faults were LAYOUT, which is the half a renderer test can actually
// reach — a style assertion here is not decoration, it is the only
// automatic guard between a flex rule and a screenshot.

const CHIP_H = 34;

test("the tab row is held to its own height, not stretched by the section below", async () => {
  await render(<About onStartTour={() => {}} onClose={() => {}} />);

  // The regression: a `flex: 1` column with nothing else claiming the
  // space grows this row to fill the screen, and the pills grow with it.
  const row = screen.getByTestId("about-tabs");
  expect(row).toHaveStyle({ height: CHIP_H + 10, flexGrow: 0 });
});

test("every pill is the same fixed height, whichever tab is open", async () => {
  await render(<About onStartTour={() => {}} onClose={() => {}} />);
  const first = ABOUT_SECTIONS[0]!;
  const third = ABOUT_SECTIONS[2]!;

  // A `minHeight` here is what let them stretch, so the assertion is on
  // an exact height and on both the selected and unselected pill.
  expect(screen.getByLabelText(first.title)).toHaveStyle({ height: CHIP_H });
  expect(screen.getByLabelText(third.title)).toHaveStyle({ height: CHIP_H });

  await userEvent.press(screen.getByLabelText(third.title));
  expect(screen.getByLabelText(first.title)).toHaveStyle({ height: CHIP_H });
  expect(screen.getByLabelText(third.title)).toHaveStyle({ height: CHIP_H });
});

test("pressing a tab shows that section", async () => {
  await render(<About onStartTour={() => {}} onClose={() => {}} />);
  const third = ABOUT_SECTIONS[2]!;

  await userEvent.press(screen.getByLabelText(third.title));
  // The heading inside the body, not the pill — the pill is numbered.
  expect(screen.getByRole("header", { name: third.title })).toBeOnTheScreen();
});

test("the last tab is reachable and shows its section", async () => {
  await render(<About onStartTour={() => {}} onClose={() => {}} />);
  const last = ABOUT_SECTIONS[ABOUT_SECTIONS.length - 1]!;

  await userEvent.press(screen.getByLabelText(last.title));
  expect(screen.getByRole("header", { name: last.title })).toBeOnTheScreen();
});

// NOT TESTED HERE, and deliberately not faked: whether the chosen tab is
// SCROLLED into view. The scroll target comes from each pill's `onLayout`
// x, and `onLayout` never fires under jest — there is no layout pass — so
// `chipAt` is empty and `scrollTo` is correctly never called. A test
// asserting it would be asserting the mock. Verified on the device
// instead, which is also where the fault was found.

test("the tour is reachable from the bottom of any section", async () => {
  const onStartTour = jest.fn();
  await render(<About onStartTour={onStartTour} onClose={() => {}} />);

  await userEvent.press(screen.getByLabelText("Take the tour"));
  expect(onStartTour).toHaveBeenCalledTimes(1);
});
