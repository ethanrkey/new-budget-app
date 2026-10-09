// The phone's sign-in logic, with no renderer in it.
//
//   node tests/mobile-signin.test.mjs     (runs in `npm test`, so in CI)
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
} from "../mobile/lib/signin.ts";

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
  // The rule: say nothing that distinguishes one account from another.
  eq("no error means advance", sendFailureMessage(null), null);
  eq("a nonexistent account advances silently", sendFailureMessage({ status: 422, message: "Signups not allowed for otp" }), null);
  eq("a social-only account advances silently", sendFailureMessage({ status: 400, message: "Unable to validate email address" }), null);
  eq("an unknown failure advances silently", sendFailureMessage({ status: 500, message: "boom" }), null);

  // The exception, and the reason for it: a rate-limited user is staring
  // at a code field waiting for mail that is definitely not coming.
  is("a 429 is spoken aloud", /wait a minute/i.test(sendFailureMessage({ status: 429, message: "x" })));
  is("the 60-second wording is caught without the status",
    /wait a minute/i.test(sendFailureMessage({ message: "For security purposes, you can only request this after 60 seconds" })));
  is("the word 'rate' is caught too", /wait a minute/i.test(sendFailureMessage({ message: "email rate limit exceeded" })));

  // The property that matters more than any single case: for every
  // failure that is NOT a rate limit, the screen behaves identically.
  const quiet = [
    { status: 422, message: "Signups not allowed for otp" },
    { status: 400, message: "Unable to validate email address: invalid format" },
    { status: 404, message: "User not found" },
    { status: 500, message: "internal error" },
  ].map(sendFailureMessage);
  is("every non-rate-limit failure is indistinguishable", quiet.every((m) => m === null));
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

console.log(failures === 0 ? `\nALL PASS (${checks} checks)` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
