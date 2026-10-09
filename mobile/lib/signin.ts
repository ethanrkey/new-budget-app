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

type AuthError = { message?: string; status?: number } | null | undefined;

/**
 * What to say when the SEND fails — and the answer is usually nothing.
 *
 * Supabase deliberately refuses to distinguish "no such account" from
 * "that account can only be reached another way", because an error that
 * distinguishes them is an account-enumeration oracle: type addresses
 * until one answers differently and you have learned who banks here. So
 * the screen advances to the code step either way and says a code is on
 * its way IF the address has an account.
 *
 * The one exception is a rate limit, and it is an exception because the
 * silence costs more than the leak. A rate-limited user is staring at a
 * code field waiting for mail that is definitely not coming; telling them
 * to wait a minute reveals only that the address was asked for recently,
 * which they already know because they are the one who asked.
 *
 * Returns a message to show INSTEAD of advancing, or null to advance.
 */
export function sendFailureMessage(error: AuthError): string | null {
  if (!error) return null;
  const rateLimited =
    error.status === 429 || /rate|too many|after \d+ seconds|security purposes/i.test(error.message ?? "");
  if (rateLimited) return "A code was just sent. Wait a minute before asking for another.";
  return null;
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
