import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import CategorySheet from "../components/CategorySheet";
import { blankCategoryDraft } from "../lib/categories";

// The add/edit form. What it decides is in lib/categories.ts and is
// tested in tests/mobile-categories.test.mjs; what is here is the half
// that only exists mounted — does the kind picker change which fields
// are on screen, does the handler receive what was typed, and does a
// refusal say why.

const TODAY = "2026-10-12";
const blank = blankCategoryDraft(TODAY);

test("a savings account asks for a balance, never for an APR", async () => {
  await render(<CategorySheet title="Add an account" draft={blank} busy={false} onSave={() => {}} onClose={() => {}} />);

  expect(screen.getByLabelText("Name")).toBeOnTheScreen();
  expect(screen.getByLabelText("What's in it")).toBeOnTheScreen();
  // Asking an asset for its interest rate is the compile error the
  // engine's types prevent; the form must not ask it either.
  expect(screen.queryByLabelText("Interest rate")).toBeNull();
  expect(screen.queryByLabelText("Original amount")).toBeNull();
});

test("picking Loan swaps the fields for a loan's", async () => {
  await render(<CategorySheet title="Add an account" draft={blank} busy={false} onSave={() => {}} onClose={() => {}} />);
  await userEvent.press(screen.getByLabelText("Loan or debt"));

  expect(screen.getByLabelText("Original amount")).toBeOnTheScreen();
  expect(screen.getByLabelText("Interest rate")).toBeOnTheScreen();
  expect(screen.getByLabelText("What you owe now")).toBeOnTheScreen();
  expect(screen.queryByLabelText("What's in it")).toBeNull();
});

test("the interest start date appears only once there is a principal to date", async () => {
  await render(<CategorySheet title="Add an account" draft={blank} busy={false} onSave={() => {}} onClose={() => {}} />);
  await userEvent.press(screen.getByLabelText("Loan or debt"));

  expect(screen.queryByLabelText(/Interest started/)).toBeNull();
  await userEvent.type(screen.getByLabelText("Original amount"), "14200");
  expect(await screen.findByLabelText(/Interest started/)).toBeOnTheScreen();
});

test("the as-of date appears only once there is a number to date", async () => {
  // A date for nothing is how an empty reading gets written.
  await render(<CategorySheet title="Add an account" draft={blank} busy={false} onSave={() => {}} onClose={() => {}} />);
  expect(screen.queryByLabelText(/As of/)).toBeNull();

  await userEvent.type(screen.getByLabelText("What's in it"), "8200");
  expect(await screen.findByLabelText(/As of/)).toBeOnTheScreen();
});

test("saving hands over exactly what was typed", async () => {
  const saved: unknown[] = [];
  await render(<CategorySheet title="Add an account" draft={blank} busy={false} onSave={(d) => saved.push(d)} onClose={() => {}} />);

  await userEvent.type(screen.getByLabelText("Name"), "Ally Savings");
  await userEvent.type(screen.getByLabelText("What's in it"), "8200");
  await userEvent.press(screen.getByLabelText("Save"));

  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toMatchObject({ name: "Ally Savings", kind: "asset", assetKind: "savings", balance: "8200" });
});

test("a refusal says why, and the button still responds", async () => {
  const saved: unknown[] = [];
  await render(<CategorySheet title="Add an account" draft={blank} busy={false} onSave={(d) => saved.push(d)} onClose={() => {}} />);

  // Validated on press rather than by disabling: a disabled button with
  // no explanation is the thing people tap twice and then give up on.
  await userEvent.press(screen.getByLabelText("Save"));
  expect(await screen.findByText("Give it a name.")).toBeOnTheScreen();
  expect(saved).toHaveLength(0);
});

test("a rate typed as a payment is caught before it is saved", async () => {
  const saved: unknown[] = [];
  await render(<CategorySheet title="Add an account" draft={blank} busy={false} onSave={(d) => saved.push(d)} onClose={() => {}} />);
  await userEvent.press(screen.getByLabelText("Loan or debt"));
  await userEvent.type(screen.getByLabelText("Name"), "Car loan");
  await userEvent.type(screen.getByLabelText("Interest rate"), "700");
  await userEvent.press(screen.getByLabelText("Save"));

  expect(await screen.findByText(/percentage/)).toBeOnTheScreen();
  expect(saved).toHaveLength(0);
});
