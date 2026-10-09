import { render, screen, fireEvent, userEvent, waitFor } from "@testing-library/react-native";
import SignIn from "../components/SignIn";
import { authCalls } from "./setup";

// Sign-in, from the taps. The logic lives in lib/signin.ts and is tested
// without a renderer in tests/mobile-signin.test.mjs; what is here is the
// half that only exists once it is mounted — does pressing the button send
// the address the field was showing, does the code step actually appear,
// and does the verify call carry both the address and the typed code.
//
// This file exists because the last two mobile bugs were both of that
// shape: a form that worked standalone while its routing did not, and a
// sheet whose logic was right and whose presentation was swallowed. A
// sign-in screen that sends a code and never shows the code field is the
// same bug with worse consequences.

beforeEach(() => {
  authCalls.otp.length = 0;
  authCalls.verify.length = 0;
  authCalls.nextOtpError = null;
  authCalls.nextVerifyError = null;
});

/**
 * Press a button once it is actually pressable.
 *
 * Both CTAs here are disabled until their field holds something valid, and
 * a state update from `changeText` is not guaranteed to have rendered by
 * the next line. Pressing the element captured from the previous render
 * presses a disabled button and silently does nothing — which is how the
 * first version of this file produced seven failures that all looked like
 * the screen was broken when it was not. On a device the gap is a frame
 * and a human; here it has to be waited for.
 */
async function pressWhenEnabled(label: string) {
  const button = await screen.findByLabelText(label);
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.press(button);
}

async function askForCode(address: string) {
  fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), address);
  await pressWhenEnabled("Email me a code");
}

test("pressing the button sends the address the field was showing", async () => {
  await render(<SignIn />);
  await askForCode("  Ethan@Example.COM ");

  await waitFor(() => expect(authCalls.otp).toHaveLength(1));
  // Trimmed and lowercased: the address that reaches Supabase must match
  // the stored one, and iOS keyboards capitalize the first letter.
  expect(authCalls.otp[0]).toEqual({
    email: "ethan@example.com",
    options: { shouldCreateUser: false },
  });
});

test("the code step appears after a send, and names the address", async () => {
  await render(<SignIn />);
  await askForCode("ethan@example.com");

  // The bug this guards: a send that succeeds and leaves you on the email
  // screen looks identical to one that failed.
  expect(await screen.findByPlaceholderText("000000")).toBeOnTheScreen();
  expect(screen.getByText("ethan@example.com")).toBeOnTheScreen();
});

test("a failed send still advances, because the error would leak who has an account", async () => {
  authCalls.nextOtpError = { message: "Signups not allowed for otp", status: 422 };
  await render(<SignIn />);
  await askForCode("stranger@example.com");

  expect(await screen.findByPlaceholderText("000000")).toBeOnTheScreen();
  expect(screen.queryByText(/Signups not allowed/)).toBeNull();
});

test("a rate limit is told to the user instead, because waiting for a code that is not coming is worse", async () => {
  authCalls.nextOtpError = { message: "For security purposes, you can only request this after 60 seconds", status: 429 };
  await render(<SignIn />);
  await askForCode("ethan@example.com");

  expect(await screen.findByText(/wait a minute/i)).toBeOnTheScreen();
  expect(screen.queryByPlaceholderText("000000")).toBeNull();
});

test("the verify button stays disabled until six digits are in", async () => {
  await render(<SignIn />);
  await askForCode("ethan@example.com");
  const field = await screen.findByPlaceholderText("000000");

  fireEvent.changeText(field, "12345");
  await waitFor(() => expect(screen.getByLabelText("Sign in")).toBeDisabled());
  await userEvent.press(screen.getByLabelText("Sign in"));
  expect(authCalls.verify).toHaveLength(0);

  fireEvent.changeText(field, "123456");
  await pressWhenEnabled("Sign in");
  await waitFor(() => expect(authCalls.verify).toHaveLength(1));
  expect(authCalls.verify[0]).toEqual({
    email: "ethan@example.com",
    token: "123456",
    type: "email",
  });
});

test("a pasted code with spaces in it still verifies", async () => {
  await render(<SignIn />);
  await askForCode("ethan@example.com");
  fireEvent.changeText(await screen.findByPlaceholderText("000000"), "123 456");
  await pressWhenEnabled("Sign in");

  await waitFor(() => expect(authCalls.verify).toHaveLength(1));
  expect((authCalls.verify[0] as { token: string }).token).toBe("123456");
});

test("a wrong code says so, and leaves you on the code step to try again", async () => {
  authCalls.nextVerifyError = { message: "Token has expired or is invalid", status: 403 };
  await render(<SignIn />);
  await askForCode("ethan@example.com");
  fireEvent.changeText(await screen.findByPlaceholderText("000000"), "000000");
  await pressWhenEnabled("Sign in");

  expect(await screen.findByText(/wrong or has expired/i)).toBeOnTheScreen();
  expect(screen.getByPlaceholderText("000000")).toBeOnTheScreen();
});

test("you can go back and fix a mistyped address", async () => {
  await render(<SignIn />);
  await askForCode("ethan@exmaple.com");
  await screen.findByPlaceholderText("000000");

  await userEvent.press(screen.getByLabelText("Use a different address"));
  // The address survives the trip back, because retyping it is the thing
  // that just went wrong.
  expect(screen.getByDisplayValue("ethan@exmaple.com")).toBeOnTheScreen();
});

test("resend is held shut for the minute Supabase enforces", async () => {
  await render(<SignIn />);
  await askForCode("ethan@example.com");
  await screen.findByPlaceholderText("000000");

  // One send so far. The resend control must not be able to add a second
  // immediately — Supabase would refuse it, and the user would be told to
  // wait by an error rather than by the button.
  await waitFor(() => expect(screen.getByLabelText("Resend the code")).toBeDisabled());
  expect(screen.getByText(/Resend in \d+s/)).toBeOnTheScreen();
  await userEvent.press(screen.getByLabelText("Resend the code"));
  expect(authCalls.otp).toHaveLength(1);
});
