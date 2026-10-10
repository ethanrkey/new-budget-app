// Sign-in logic, with no React in it, so it can be tested in milliseconds
// by tests/mobile-signin.test.mjs rather than through a renderer.
//
// WHY A CODE AND NOT A LINK. The same `signInWithOtp` the web calls can
// send either, and the email template decides which: `{{ .ConfirmationURL }}`
// renders a clickable link, `{{ .Token }}` renders a six-digit code. The
// phone takes the code, and the reason is cost, not taste — a link has to
// come back into the app, which means a registered URL scheme, a
// redirect allow-list entry, and a redirect that survives whatever sandbox
// the app is running in. A typed code needs none of that. It is the same
// credential either way.
//
// WHY NO PASSWORD. Nothing in this app has ever set one. The web signs
// people up with Google or a magic link, so an account's password is
// whatever was done to it from outside — which for everyone but the
// author is nothing at all.

// SIX, AND THIS NUMBER IS NOT OURS ALONE. It has to equal
// Authentication -> Email OTP Length in the Supabase dashboard, which was
// set to EIGHT until 2026-10-10. With the two disagreeing, the field caps
// what you can enter at six, `normalizeCode` slices to six, and every
// real eight-digit code is truncated into a wrong one — so sign-in fails
// for everybody, with "that code is wrong" as the only clue, and the code
// in the email is correct. Nothing in this repo can read that setting, so
// it is written down in the spec under live configuration instead.
export const CODE_LENGTH = 6;

/** Supabase sends at most one OTP per address per minute. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * iOS capitalizes the first letter of a text field by default and people
 * paste addresses with spaces around them. Supabase matches the stored
 * address exactly, so neither can be allowed through.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Deliberately not an RFC-compliant check. The server is the authority on
 * whether an address exists; this only catches the empty field and the
 * obvious typo, so that a press which cannot possibly work costs nothing.
 */
export function isPlausibleEmail(email: string): boolean {
  if (email.length < 3 || email.length > 320) return false;
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return false;
  const domain = email.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".") && !/\s/.test(email);
}

/** Digits only, capped. Lets someone paste "123 456" or "Code: 123456". */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

export function codeReady(code: string): boolean {
  return normalizeCode(code).length === CODE_LENGTH;
}

/** Seconds left before another code may be requested. 0 means now. */
export function resendIn(lastSentAtMs: number | null, nowMs: number): number {
  if (lastSentAtMs == null) return 0;
  const elapsed = Math.floor((nowMs - lastSentAtMs) / 1000);
  return Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);
}

type AuthError = { message?: string; status?: number; code?: string } | null | undefined;

/** The one failure that means "there is no account at that address". */
function isUnknownAccount(error: NonNullable<AuthError>): boolean {
  // With `shouldCreateUser: false`, GoTrue refuses an address it does not
  // know with this specific signup error. It is the ONLY failure that is
  // about who the user is rather than about whether the request worked.
  return error.code === "otp_disabled" || /signups not allowed/i.test(error.message ?? "");
}

function isRateLimited(error: NonNullable<AuthError>): boolean {
  return error.status === 429
    || error.code === "over_email_send_rate_limit"
    || /rate limit|too many|after \d+ seconds|security purposes/i.test(error.message ?? "");
}

function isUnreachable(error: NonNullable<AuthError>): boolean {
  // supabase-js reports a dead network as a fetch failure with no HTTP
  // status at all, which is exactly how it differs from a server that
  // answered badly.
  return (error.status == null || error.status === 0)
    && /failed to fetch|network request failed|network error|load failed/i.test(error.message ?? "");
}

/**
 * What to say when the SEND fails. Returns a message to show INSTEAD of
 * advancing to the code step, or null to advance.
 *
 * ONE failure is hidden, and only one: the address has no account.
 * Supabase does distinguish that case — with `shouldCreateUser: false` it
 * answers with a signup error naming it — so the concealment is this
 * app's choice, not the server's. The reason to make it: an error that
 * distinguishes "no account here" from "code sent" is an
 * account-enumeration oracle, and someone with a list of addresses can
 * learn which of them bank here by typing them in. So that one advances
 * to the code step and says a code is on its way IF the address has an
 * account, which is true.
 *
 * EVERY OTHER FAILURE IS SPOKEN, and the first version of this function
 * got that wrong: it hid anything that was not a rate limit, so a dead
 * network, a 500, and an SMTP outage all produced a confident "a code is
 * on its way" and a code field that would wait forever. Those failures
 * reveal nothing about who has an account — they are about whether the
 * request happened at all — so there is nothing to protect and a user
 * owed an answer.
 */
export function sendFailureMessage(error: AuthError): string | null {
  if (!error) return null;
  if (isUnknownAccount(error)) return null;
  if (isRateLimited(error)) return "A code was just sent. Wait a minute before asking for another.";
  if (isUnreachable(error)) return "Can't reach the server. Check your connection and try again.";
  // A server that answered, badly. Worth separating from the above
  // because the user can do nothing about it and should not be told to
  // check their wifi.
  return "Something went wrong sending the code. Try again in a moment.";
}

/**
 * What to say when the VERIFY fails. These are surfaced, because the user
 * typed something and is owed an answer about it, and because none of
 * them reveals whether the account exists — you only reach this step
 * after asking for a code for that address yourself.
 */
export function verifyFailureMessage(error: AuthError): string {
  const message = error?.message ?? "";
  if (/expired|invalid|token/i.test(message)) {
    return "That code is wrong or has expired. Check the latest email, or ask for a new code.";
  }
  if (error?.status === 429 || /rate|too many/i.test(message)) {
    return "Too many tries. Wait a minute, then ask for a new code.";
  }
  return message || "That did not work. Ask for a new code and try again.";
}
