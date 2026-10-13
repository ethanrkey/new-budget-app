// Sign-in logic, for BOTH clients, with no renderer in it.
//
//   node tests/signin.test.mjs     (runs in `npm test`, so in CI)
//
// It was tests/mobile-signin.test.mjs until 2026-10-14, when the web
// grew a code box and the shared half moved to src/signin.ts. The old
// name was a lie the moment the web started calling the same
// functions, and a file named after one client is a file the other
// client's author does not think to read.
//
// Everything here is a decision the screen makes before it talks to
// Supabase, or a decision about what to SAY when Supabase refuses. Both
// kinds are easy to get wrong in ways no type catches: an address that
// reaches the server with a capital letter matches nothing, and an error
// message that distinguishes "no such account" from "wrong code" is an
// account-enumeration oracle.
//
// The mounted half — does pressing the button send what the field showed,
// does the code step appear — is in mobile/__tests__/signin.test.tsx,
// because none of it exists until something renders.
import {
  CODE_LENGTH, RESEND_COOLDOWN_SECONDS, normalizeEmail, isPlausibleEmail,
  normalizeCode, codeReady, resendIn, sendFailureMessage, verifyFailureMessage,
} from "../src/shared/signin.ts";
// The two that stayed on the phone, because they read error codes only
// a native SDK produces.
import { googleFailureMessage, appleFailureMessage } from "../mobile/lib/signin.ts";

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function eq(label, got, want) {
  checks++;
  const ok = show(got) === show(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${show(got)}\n        want ${show(want)}`}`);
}
const is = (label, cond) => eq(label, !!cond, true);
const not = (label, cond) => eq(label, !!cond, false);

// ---- the address -----------------------------------------------------
{
  eq("an iOS-capitalized address is lowercased", normalizeEmail("Ethan@Example.com"), "ethan@example.com");
  eq("a pasted address is trimmed", normalizeEmail("  ethan@example.com\n"), "ethan@example.com");
  // This is the whole reason normalizeEmail exists: Supabase matches the
  // stored address exactly, so "Ethan@..." finds nobody and the screen
  // would show the same "a code is on its way" it shows on success.
  eq("both at once", normalizeEmail(" ETHAN@Example.COM "), "ethan@example.com");

  is("an ordinary address passes", isPlausibleEmail("ethan@example.com"));
  is("a subdomain passes", isPlausibleEmail("ethan@mail.bu.edu"));
  is("a plus tag passes", isPlausibleEmail("ethan+budget@example.com"));
  not("empty does not", isPlausibleEmail(""));
  not("no at sign does not", isPlausibleEmail("ethan.example.com"));
  not("two at signs do not", isPlausibleEmail("ethan@@example.com"));
  not("nothing before the at does not", isPlausibleEmail("@example.com"));
  not("a domain with no dot does not", isPlausibleEmail("ethan@localhost"));
  not("a trailing dot does not", isPlausibleEmail("ethan@example."));
  not("an inner space does not", isPlausibleEmail("et han@example.com"));
}

// ---- the code --------------------------------------------------------
{
  eq("a pasted code with a space loses it", normalizeCode("123 456"), "123456");
  eq("a code pasted with its label survives", normalizeCode("Code: 123456"), "123456");
  eq("extra digits are cut, not rejected", normalizeCode("1234567890"), "123456");
  eq("letters are dropped", normalizeCode("12a34b56"), "123456");
  eq("the length is the constant, not a literal", normalizeCode("1234567890").length, CODE_LENGTH);

  is("six digits is ready", codeReady("123456"));
  not("five is not", codeReady("12345"));
  not("empty is not", codeReady(""));
  is("six digits with junk around them is ready", codeReady(" 123 456 "));
}

// ---- the resend cooldown --------------------------------------------
{
  eq("nothing sent yet means no wait", resendIn(null, 1_000_000), 0);
  eq("just sent means the full minute", resendIn(1_000_000, 1_000_000), RESEND_COOLDOWN_SECONDS);
  eq("half way through", resendIn(1_000_000, 1_030_000), 30);
  eq("exactly elapsed is zero", resendIn(1_000_000, 1_060_000), 0);
  eq("past it never goes negative", resendIn(1_000_000, 9_000_000), 0);
}

// ---- what a failed SEND is allowed to reveal -------------------------
{
  // Exactly ONE failure is hidden: the address has no account. Supabase
  // does distinguish it — the concealment is this app's — and the reason
  // is that an error which distinguishes "no account" from "code sent"
  // lets anyone with a list of addresses learn who banks here.
  eq("no error means advance", sendFailureMessage(null), null);
  eq("a nonexistent account advances silently",
    sendFailureMessage({ status: 422, message: "Signups not allowed for otp" }), null);
  eq("...by error code too, not only by wording",
    sendFailureMessage({ status: 422, code: "otp_disabled", message: "whatever GoTrue says next year" }), null);

  // EVERYTHING ELSE IS SPOKEN. The first version of this hid every
  // non-rate-limit failure, so a dead network produced "a code is on its
  // way" and a code field that would wait forever.
  is("OFFLINE is spoken", /check your connection/i.test(
    sendFailureMessage({ message: "Network request failed" })));
  is("a fetch failure with no status is offline, not a server error", /check your connection/i.test(
    sendFailureMessage({ status: 0, message: "Failed to fetch" })));
  is("iOS wording for a dead network is caught too", /check your connection/i.test(
    sendFailureMessage({ message: "Load failed" })));

  is("a 500 is spoken, and does NOT blame the user's wifi", /went wrong/i.test(
    sendFailureMessage({ status: 500, message: "Error sending magic link email" })));
  is("an SMTP outage is a server error, not a missing account", /went wrong/i.test(
    sendFailureMessage({ status: 500, message: "Error sending confirmation email" })));
  not("a 500 is not reported as offline", /connection/i.test(
    sendFailureMessage({ status: 500, message: "Error sending magic link email" })));

  is("a 429 is spoken aloud", /wait a minute/i.test(sendFailureMessage({ status: 429, message: "x" })));
  is("the 60-second wording is caught without the status",
    /wait a minute/i.test(sendFailureMessage({ message: "For security purposes, you can only request this after 60 seconds" })));
  is("the send-rate error code is caught too",
    /wait a minute/i.test(sendFailureMessage({ code: "over_email_send_rate_limit", message: "" })));

  // The property that matters: exactly one failure is indistinguishable
  // from success, and it is the one about account existence.
  const hidden = [
    { status: 422, message: "Signups not allowed for otp" },
    { status: 422, code: "otp_disabled", message: "" },
  ].map(sendFailureMessage);
  is("only the account-existence failures are hidden", hidden.every((m) => m === null));

  const spoken = [
    { message: "Network request failed" },
    { status: 429, message: "rate limit" },
    { status: 500, message: "Error sending magic link email" },
    { status: 400, message: "Unable to validate email address: invalid format" },
    { status: 503, message: "service unavailable" },
  ].map(sendFailureMessage);
  is("every other failure says something", spoken.every((m) => typeof m === "string" && m.length > 0));
}

// ---- what a failed VERIFY says ---------------------------------------
{
  // These ARE surfaced: you only get here after asking for a code for
  // that address yourself, so nothing is revealed that you did not supply.
  is("a bad token is named", /wrong or has expired/i.test(verifyFailureMessage({ status: 403, message: "Token has expired or is invalid" })));
  is("an expired token is the same message", /wrong or has expired/i.test(verifyFailureMessage({ message: "otp_expired" })));
  is("too many tries says to wait", /wait a minute/i.test(verifyFailureMessage({ status: 429, message: "too many requests" })));
  is("an unknown failure still says something", verifyFailureMessage({ message: "" }).length > 0);
  is("a null error still says something", verifyFailureMessage(null).length > 0);
  // Never leave the user with a dead end and no instruction.
  const all = [null, { message: "" }, { status: 403, message: "Token has expired or is invalid" }, { status: 429, message: "rate" }];
  is("every verify failure tells you what to do next",
    all.map(verifyFailureMessage).every((m) => /code/i.test(m)));
}

// ---- what Google sign-in says when it does not work -----------------
{
  // A dismissed sheet is NOT a failure. The user closed it because they
  // changed their mind, and red text under the button would say "that
  // did not work" about the thing that worked.
  eq("a cancel says nothing", googleFailureMessage({ code: "SIGN_IN_CANCELLED" }), null);
  eq("the iOS cancel code says nothing", googleFailureMessage({ code: "-5" }), null);
  eq("a cancel by wording says nothing", googleFailureMessage({ message: "The user canceled the sign-in flow." }), null);
  eq("a double tap says nothing", googleFailureMessage({ code: "IN_PROGRESS" }), null);

  is("offline is spoken", /check your connection/i.test(googleFailureMessage({ message: "Network error" })));
  // The misconfiguration shape: Supabase refusing the token's audience,
  // or wanting a nonce the native SDK cannot produce. Worth its own
  // message, because the user can do nothing and support can do a lot.
  is("a rejected audience blames us, not the user",
    /on us/i.test(googleFailureMessage({ message: "Invalid audience in id_token" })));
  is("a missing nonce lands in the same bucket",
    /on us/i.test(googleFailureMessage({ message: "Passed nonce and nonce in id_token should either both exist or not." })));
  is("an unknown failure still says something", googleFailureMessage({ message: "" }).length > 0);
  is("a null error still says something", googleFailureMessage(null).length > 0);
  is("every spoken Google failure offers the way out that works",
    [{ message: "" }, null, { message: "Invalid audience" }]
      .map(googleFailureMessage).every((m) => /emailed code/i.test(m)));
}

// ---- Sign in with Apple ---------------------------------------------
{
  // Apple's sheet is dismissed far more often than Google's, because it
  // appears over the app without a tap on an account first. A line of
  // red for "I changed my mind" would be wrong most of the time.
  eq("a cancel says nothing", appleFailureMessage({ code: "ERR_REQUEST_CANCELED" }), null);
  eq("...by either spelling of the code", appleFailureMessage({ code: "ERR_CANCELED" }), null);
  eq("...and by wording", appleFailureMessage({ message: "The user canceled the authorization attempt." }), null);

  is("offline is spoken", /check your connection/i.test(appleFailureMessage({ message: "Network request failed" })));
  is("a rejected audience blames us, not the user",
    /on us/i.test(appleFailureMessage({ message: "Unacceptable audience in id_token" })));
  is("a wrong Client ID lands in the same bucket",
    /on us/i.test(appleFailureMessage({ message: "Invalid client id" })));
  is("an unknown failure still says something", appleFailureMessage({ message: "" }).length > 0);
  is("a null error still says something", appleFailureMessage(null).length > 0);
  is("every spoken Apple failure offers the way out that works",
    [{ message: "" }, null, { message: "Unacceptable audience" }]
      .map(appleFailureMessage).every((m) => /emailed code/i.test(m)));
}

// A SUITE THAT RUNS NO CHECKS EXITS 0, and that is not hypothetical: a
// bad edit truncated tests/signin.test.mjs to its header on 2026-10-14
// and `npm test` stayed green through the whole run. The floor is
// deliberately far below any real count — it is here to catch a file
// that has been emptied, not to track how many checks it should have.
if (checks < 10) {
  console.log(`FAIL  this suite ran only ${checks} checks — truncated, or short-circuited before the end`);
  failures++;
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
