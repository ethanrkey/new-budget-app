import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import SignIn from "../components/SignIn";
import { authCalls } from "./setup";

// Sign-in, from the taps. The logic lives in lib/signin.ts and is tested
// without a renderer in tests/mobile-signin.test.mjs; what is here is the
// half that only exists once it is mounted — does pressing the button send
// the address the field was showing, does the code step actually appear,
// and does the sixth digit submit without anyone pressing anything.
//
// This file exists because the last two mobile bugs were both of that
// shape: a form that worked standalone while its routing did not, and a
// sheet whose logic was right and whose presentation was swallowed. A
// sign-in screen that sends a code and never shows the code field is the
// same bug with worse consequences.
//
// ───────────────────────────────────────────────────────────────────────
// EVERY KEYSTROKE GOES THROUGH `userEvent`, NEVER `fireEvent.changeText`.
// That is not style. Two `fireEvent.changeText` calls against a controlled
// TextInput destroy the renderer in this harness: the second detaches the
// tree, so `render()` in the NEXT test returns null and every query after
// it fails for reasons that have nothing to do with the test that fails.
// It cost an evening, because the failures all appear in correct tests.
// Reproduced on a four-line component with no app code in it, so it is the
// harness and not this screen. `userEvent.type` types key by key and
// survives it; `userEvent.paste` is the single-event case. Measured
// 2026-10-10 — recorded in the spec under Verification.
// ───────────────────────────────────────────────────────────────────────

beforeEach(() => {
  authCalls.otp.length = 0;
  authCalls.verify.length = 0;
  authCalls.nextOtpError = null;
  authCalls.nextVerifyError = null;
});

/**
 * Press a button once it is actually pressable.
 *
 * Both CTAs are disabled until their field holds something valid, and
 * pressing an element captured from an earlier render presses a disabled
 * button and silently does nothing.
 */
async function pressWhenEnabled(label: string) {
  const button = await screen.findByLabelText(label);
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.press(button);
}

/** Let an auto-submitted verify finish before the test ends. */
const settle = () => waitFor(() => expect(screen.getByLabelText("Sign in")).toBeEnabled());

async function askForCode(address: string) {
  await userEvent.type(screen.getByPlaceholderText("you@example.com"), address);
  await pressWhenEnabled("Email me a code");
  return screen.findByPlaceholderText("000000");
}

test("pressing the button sends the address the field was showing", async () => {
  await render(<SignIn />);
  await askForCode("Ethan@Example.COM ");

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
  expect(screen.getByPlaceholderText("000000")).toBeOnTheScreen();
  expect(screen.getByText("ethan@example.com")).toBeOnTheScreen();
});

test("a failed send still advances, because the error would leak who has an account", async () => {
  authCalls.nextOtpError = { message: "Signups not allowed for otp", status: 422 };
  await render(<SignIn />);
  await askForCode("stranger@example.com");

  expect(screen.getByPlaceholderText("000000")).toBeOnTheScreen();
  expect(screen.queryByText(/Signups not allowed/)).toBeNull();
});

test("a rate limit is told to the user instead, because waiting for a code that is not coming is worse", async () => {
  authCalls.nextOtpError = { message: "For security purposes, you can only request this after 60 seconds", status: 429 };
  await render(<SignIn />);
  await userEvent.type(screen.getByPlaceholderText("you@example.com"), "ethan@example.com");
  await pressWhenEnabled("Email me a code");

  expect(await screen.findByText(/wait a minute/i)).toBeOnTheScreen();
  expect(screen.queryByPlaceholderText("000000")).toBeNull();
});

test("OFFLINE says so, and does not pretend a code is coming", async () => {
  // The bug this replaces: every failure that was not a rate limit was
  // swallowed, so a phone with no signal advanced to a code field and
  // waited for mail that had never been requested.
  authCalls.nextOtpError = { message: "Network request failed" };
  await render(<SignIn />);
  await userEvent.type(screen.getByPlaceholderText("you@example.com"), "ethan@example.com");
  await pressWhenEnabled("Email me a code");

  expect(await screen.findByText(/check your connection/i)).toBeOnTheScreen();
  expect(screen.queryByPlaceholderText("000000")).toBeNull();
});

test("a server that answered badly is spoken too, without blaming the wifi", async () => {
  authCalls.nextOtpError = { status: 500, message: "Error sending magic link email" };
  await render(<SignIn />);
  await userEvent.type(screen.getByPlaceholderText("you@example.com"), "ethan@example.com");
  await pressWhenEnabled("Email me a code");

  expect(await screen.findByText(/went wrong/i)).toBeOnTheScreen();
  expect(screen.queryByText(/connection/i)).toBeNull();
  expect(screen.queryByPlaceholderText("000000")).toBeNull();
});

test("five digits sends nothing, and the button says so", async () => {
  await render(<SignIn />);
  const field = await askForCode("ethan@example.com");
  await userEvent.type(field, "12345");

  expect(authCalls.verify).toHaveLength(0);
  await waitFor(() => expect(screen.getByLabelText("Sign in")).toBeDisabled());
});

test("THE POINT: the sixth digit submits on its own, with no press", async () => {
  await render(<SignIn />);
  const field = await askForCode("ethan@example.com");

  // Typed one key at a time, and nothing below this line is pressed. The
  // sixth keystroke fires before `setCode` has landed, so a handler that
  // read state instead of the incoming value would send five digits.
  await userEvent.type(field, "123456");

  await waitFor(() => expect(authCalls.verify).toHaveLength(1));
  expect(authCalls.verify[0]).toEqual({
    email: "ethan@example.com",
    token: "123456",
    type: "email",
  });
  await settle();
});

test("a whole code arriving at once submits too — paste, and iOS autofill", async () => {
  await render(<SignIn />);
  const field = await askForCode("ethan@example.com");
  // One event carrying all six digits is what both a paste and the
  // one-time-code keyboard suggestion look like to the field.
  await userEvent.paste(field, "123 456");

  await waitFor(() => expect(authCalls.verify).toHaveLength(1));
  expect((authCalls.verify[0] as { token: string }).token).toBe("123456");
  await settle();
});

test("a wrong code says so, and leaves you on the code step to try again", async () => {
  authCalls.nextVerifyError = { message: "Token has expired or is invalid", status: 403 };
  await render(<SignIn />);
  const field = await askForCode("ethan@example.com");
  await userEvent.paste(field, "000000");

  expect(await screen.findByText(/wrong or has expired/i)).toBeOnTheScreen();
  expect(screen.getByPlaceholderText("000000")).toBeOnTheScreen();
  expect(authCalls.verify).toHaveLength(1);
});

test("a rejected code is not auto-submitted again while it sits in the field", async () => {
  authCalls.nextVerifyError = { message: "Token has expired or is invalid", status: 403 };
  await render(<SignIn />);
  const field = await askForCode("ethan@example.com");
  await userEvent.paste(field, "000000");
  await screen.findByText(/wrong or has expired/i);

  // Re-entering the SAME six digits must not fire again — otherwise every
  // correction after a rejection is another request at the auth endpoint.
  await userEvent.clear(field);
  await userEvent.paste(field, "000000");
  await waitFor(() => expect(screen.getByLabelText("Sign in")).toBeEnabled());
  expect(authCalls.verify).toHaveLength(1);
});

test("...and THAT is what the button is for", async () => {
  authCalls.nextVerifyError = { message: "Token has expired or is invalid", status: 403 };
  await render(<SignIn />);
  const field = await askForCode("ethan@example.com");
  await userEvent.paste(field, "000000");
  await screen.findByText(/wrong or has expired/i);

  await pressWhenEnabled("Sign in");
  await waitFor(() => expect(authCalls.verify).toHaveLength(2));
  expect((authCalls.verify[1] as { token: string }).token).toBe("000000");
  await settle();
});

test("a different six digits after a rejection submits on its own", async () => {
  authCalls.nextVerifyError = { message: "Token has expired or is invalid", status: 403 };
  await render(<SignIn />);
  const field = await askForCode("ethan@example.com");
  await userEvent.paste(field, "000000");
  await screen.findByText(/wrong or has expired/i);

  await userEvent.clear(field);
  await userEvent.paste(field, "123456");
  await waitFor(() => expect(authCalls.verify).toHaveLength(2));
  expect((authCalls.verify[1] as { token: string }).token).toBe("123456");
  await settle();
});

test("you can go back and fix a mistyped address", async () => {
  await render(<SignIn />);
  await askForCode("ethan@exmaple.com");

  await userEvent.press(screen.getByLabelText("Use a different address"));
  // The address survives the trip back, because retyping it is the thing
  // that just went wrong.
  expect(screen.getByDisplayValue("ethan@exmaple.com")).toBeOnTheScreen();
});

test("resend is held shut for the minute Supabase enforces", async () => {
  await render(<SignIn />);
  await askForCode("ethan@example.com");

  // One send so far. The resend control must not be able to add a second
  // immediately — Supabase would refuse it, and the user would be told to
  // wait by an error rather than by the button.
  await waitFor(() => expect(screen.getByLabelText("Resend the code")).toBeDisabled());
  expect(screen.getByText(/Resend in \d+s/)).toBeOnTheScreen();
  await userEvent.press(screen.getByLabelText("Resend the code"));
  expect(authCalls.otp).toHaveLength(1);
});
