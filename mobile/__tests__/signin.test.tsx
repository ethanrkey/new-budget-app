import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import { Keyboard } from "react-native";
import SignIn from "../components/SignIn";
import { authCalls, googleCalls, appleCalls } from "./setup";
import { loadPrefs } from "../lib/prefs";

// Sign-in, from the taps. The logic lives in lib/signin.ts and is tested
// without a renderer in tests/signin.test.mjs; what is here is the
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

beforeEach(async () => {
  authCalls.otp.length = 0;
  authCalls.verify.length = 0;
  authCalls.nextOtpError = null;
  authCalls.nextVerifyError = null;
  googleCalls.count = 0;
  googleCalls.next = { ok: true, message: null };
  authCalls.idTokens.length = 0;
  authCalls.functions.length = 0;
  appleCalls.available = true;
  appleCalls.signIns = 0;
  appleCalls.next = { identityToken: "apple.id.token", authorizationCode: "apple-auth-code", error: null };
  authCalls.nextFunctionError = null;
  const AsyncStorage = require("@react-native-async-storage/async-storage");
  await AsyncStorage.clear();
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

test("Google is offered on the email step, and pressing it calls through", async () => {
  await render(<SignIn />);
  await userEvent.press(screen.getByLabelText("Continue with Google"));

  await waitFor(() => expect(googleCalls.count).toBe(1));
  // Nothing to assert about success: the auth listener swaps the screen.
  expect(screen.queryByPlaceholderText("000000")).toBeNull();
});

test("Google's button wears Google's branding, not a plain rectangle", async () => {
  // It was a bordered surface rectangle with the words in it and no
  // mark at all, sitting next to a real AppleAuthenticationButton —
  // off-brand, and visibly the lesser of the two options.
  await render(<SignIn />);
  const button = screen.getByLabelText("Continue with Google");

  // Google's LIGHT theme, by the numbers in its branding guidelines.
  // Asserted as literals on purpose: these colors belong to Google,
  // and a theme token someone later retunes would take the button
  // off-brand without anything noticing.
  expect(button).toHaveStyle({ backgroundColor: "#FFFFFF", borderColor: "#747775", borderWidth: 1 });

  // The four-color G, unaltered. All four of Google's hues have to be
  // on screen: redrawing the mark as a single-color glyph is the usual
  // way this goes wrong, and it would still look like a button.
  // react-native-svg stores a fill as opaque ARGB, so that is what the
  // tree holds rather than the hex string.
  //
  // `_owner` IS DROPPED, and it has to be. A rendered tree that holds
  // a React element in a prop — SymbolView's `fallback`, here — has a
  // FiberNode on that element's `_owner`, and a plain
  // JSON.stringify of the tree throws "Converting circular
  // structure". Nothing about this screen changed to cause that; the
  // Apple mark simply arrived with a fallback.
  const tree = JSON.stringify(screen.toJSON(), (k, v) => (k === "_owner" ? undefined : v));
  for (const hue of ["EA4335", "4285F4", "FBBC05", "34A853"]) {
    expect(tree).toContain(String(0xff000000 + parseInt(hue, 16)));
  }

  // And the approved wording, which is also the word Apple's CONTINUE
  // button uses, so the two read as a pair rather than as two makes.
  expect(screen.getByText("Continue with Google")).toBeOnTheScreen();
});

test("the two brand buttons are the same button", async () => {
  // Reported from a device on build 8: "the text sizes differ and the
  // logos sit in different spots."
  //
  // They did, because only one of the two was ours. Google's was a
  // Pressable with a 15pt label centered in the whole button and the
  // G pinned absolutely at the leading edge; Apple's was
  // ASAuthorizationAppleIDButton, which draws its own title in a font
  // sized from its own frame and exposes no way to read or set it.
  // Both are BrandButton now, so this asserts they came out of the
  // same mold — change one of these numbers on one button and there
  // is nowhere to change it.
  await render(<SignIn />);
  const apple = await screen.findByLabelText("Continue with Apple");
  const google = screen.getByLabelText("Continue with Google");

  // THE LITERALS, not BRAND_BUTTON's own values. Asserting a
  // component's constant against itself passes whatever the constant
  // says, which is how a test for "these numbers" ends up testing
  // nothing: retuning fontSize to 15 would still be green. These are
  // the layout that was reasoned out against both sets of
  // guidelines, so they are written down twice on purpose.
  for (const button of [apple, google]) {
    expect(button).toHaveStyle({
      height: 50,
      borderRadius: 12,
      // Centered as a GROUP — the mark in the flow, not pinned to an
      // edge. This is the layout Apple's own button uses and the one
      // Google's rendered button uses when it is wider than its
      // content, which is why it is the one both can wear.
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 12,
    });
  }
  for (const label of ["Continue with Apple", "Continue with Google"]) {
    expect(screen.getByText(label)).toHaveStyle({ fontSize: 17, fontWeight: "500" });
  }

  // ...and they agree with EACH OTHER, which is the property the
  // report was actually about. This one survives a deliberate change
  // to the layout above; what it will not survive is changing one
  // button and not the other.
  const box = (el: { props: Record<string, unknown> }) => {
    const flat = Object.assign({}, ...[el.props.style].flat(9).filter(Boolean));
    // Colors are each brand's and are meant to differ.
    const { backgroundColor, borderColor, borderWidth, ...rest } = flat;
    return rest;
  };
  expect(box(apple)).toEqual(box(google));

  // The mark comes FIRST inside each button, which is the other half
  // of "same logo placement": a trailing mark would still pass every
  // style assertion above.
  for (const button of [apple, google]) {
    const kids = button.children as unknown[];
    expect(kids).toHaveLength(2);
    expect(String((kids[1] as { props: { children: string } }).props.children)).toMatch(/^Continue with/);
  }

  // And Apple's mark is APPLE'S mark — the system's own artwork, not
  // a path somebody traced. Drawing one is the thing the guidelines
  // forbid outright.
  expect(screen.getByTestId("apple-mark").props.name).toBe("apple.logo");
});

test("tapping off the field puts the keyboard away", async () => {
  // The email field autofocuses, so the keyboard is up before
  // anything is typed — and neither keyboard here has a key that
  // dismisses it: the email step asks for "go" and the code step is a
  // number pad with no return key at all. Until build 9 the only way
  // off this screen was to submit.
  const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
  try {
    await render(<SignIn />);
    await userEvent.press(screen.getByTestId("signin-backdrop"));
    expect(dismiss).toHaveBeenCalled();
  } finally {
    dismiss.mockRestore();
  }
});

test("a dismissed Google sheet says nothing at all", async () => {
  // The one that is easy to get wrong. A cancel returns no message, and
  // red text under the button would call a deliberate choice a failure.
  googleCalls.next = { ok: false, message: null };
  await render(<SignIn />);
  await userEvent.press(screen.getByLabelText("Continue with Google"));

  await waitFor(() => expect(googleCalls.count).toBe(1));
  expect(screen.queryByText(/didn't work|try again|on us/i)).toBeNull();
});

test("a real Google failure is shown", async () => {
  googleCalls.next = { ok: false, message: "Can't reach Google. Check your connection and try again." };
  await render(<SignIn />);
  await userEvent.press(screen.getByLabelText("Continue with Google"));

  expect(await screen.findByText(/reach Google/i)).toBeOnTheScreen();
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


// ---- Sign in with Apple ----------------------------------------------
//
// Required by guideline 4.8 next to Google, so these are not nice-to-
// haves: a build that offers Google and not this is a rejection.

test("Apple's button is drawn once the OS says it is available", async () => {
  await render(<SignIn />);
  expect(await screen.findByLabelText("Continue with Apple")).toBeOnTheScreen();
  // And above Google, because an option listed last reads as the lesser
  // one and 4.8 asks for an equivalent.
  const order = screen.getAllByRole("button").map((b) => b.props.accessibilityLabel);
  expect(order.indexOf("Continue with Apple")).toBeLessThan(order.indexOf("Continue with Google"));
});

test("a device that cannot do it is not shown a button that cannot work", async () => {
  appleCalls.available = false;
  await render(<SignIn />);
  await screen.findByLabelText("Email me a code");
  expect(screen.queryByLabelText("Continue with Apple")).toBeNull();
});

test("the identity token reaches Supabase, and the authorization code reaches the server", async () => {
  await render(<SignIn />);
  await userEvent.press(await screen.findByLabelText("Continue with Apple"));

  await waitFor(() => expect(authCalls.idTokens).toHaveLength(1));
  expect(authCalls.idTokens[0]).toEqual({ provider: "apple", token: "apple.id.token" });

  // THE PART THAT IS EASY TO LEAVE OUT. The authorization code expires
  // in five minutes and works once, so it has to go to the server at
  // sign-in — storing it for a deletion months later exchanges nothing.
  await waitFor(() => expect(authCalls.functions).toHaveLength(1));
  expect(authCalls.functions[0]).toEqual({ name: "apple-link", body: { code: "apple-auth-code" } });
});

test("a dismissed Apple sheet says nothing", async () => {
  appleCalls.next = { identityToken: null, authorizationCode: null, error: { code: "ERR_REQUEST_CANCELED", message: "The user canceled the authorization attempt." } };
  await render(<SignIn />);
  await userEvent.press(await screen.findByLabelText("Continue with Apple"));

  await waitFor(() => expect(appleCalls.signIns).toBe(1));
  expect(authCalls.idTokens).toHaveLength(0);
  // Changing your mind is not an error, and a line of red under the
  // button would say it was. Asserted on the ERROR LINE ITSELF rather
  // than on one phrase it might contain: the first version of this
  // checked for "didn't work" and would have passed while the screen
  // showed Apple's own "The user canceled the authorization attempt."
  // The mutation audit found that, not a person.
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("Continue with Apple")).toBeOnTheScreen();
});

test("Supabase refusing the token is said out loud, and nothing is sent to the server", async () => {
  authCalls.nextIdTokenError = { message: "Unacceptable audience in id_token" };
  await render(<SignIn />);
  await userEvent.press(await screen.findByLabelText("Continue with Apple"));

  expect(await screen.findByText(/this app's setup rejected it/)).toBeOnTheScreen();
  expect(screen.getByRole("alert")).toBeOnTheScreen();
  // No session, so no code to link — sending one would be a call with
  // no user attached to it.
  expect(authCalls.functions).toHaveLength(0);
});


test("a token exchange that fails is recorded, and one that works clears it", async () => {
  // It was silent for days: the exchange failed with invalid_client and
  // the only record was an edge function log. The flag is what Settings
  // reads to say so out loud.
  authCalls.nextFunctionError = { message: "apple refused the authorization code" };
  await render(<SignIn />);
  await userEvent.press(await screen.findByLabelText("Continue with Apple"));
  await waitFor(async () => expect((await loadPrefs()).appleLinkFailed).toBe(true));

  // A SUCCESS HAS TO CLEAR IT, or the notice outlives the problem and
  // becomes furniture. Signing in again is the repair, because every
  // Apple sign-in brings a fresh authorization code.
  screen.unmount();
  await render(<SignIn />);
  await userEvent.press(await screen.findByLabelText("Continue with Apple"));
  await waitFor(async () => expect((await loadPrefs()).appleLinkFailed).toBe(false));
});
