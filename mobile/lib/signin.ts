// The phone's half of sign-in: the two message mappers that read error
// codes only a native SDK produces.
//
// EVERYTHING ELSE MOVED to src/signin.ts on 2026-10-14, when the web
// grew a code box and the two clients started reading the same six
// digits. Re-exported here so every caller and every test keeps its
// import, and so there is still exactly one place a phone screen
// imports sign-in logic from.
export {
  CODE_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  normalizeEmail,
  isPlausibleEmail,
  normalizeCode,
  codeReady,
  resendIn,
  sendFailureMessage,
  verifyFailureMessage,
} from "../../src/signin.ts";
import type { AuthError } from "../../src/signin.ts";

/**
 * What to tell the user when GOOGLE sign-in fails.
 *
 * It lives here rather than in lib/google.ts for a mechanical reason
 * worth recording: google.ts imports expo-constants, and Node refuses
 * to type-strip TypeScript inside node_modules, so the plain-node
 * harness cannot import that file at all. Splitting the pure half out
 * is what keeps every branch below testable in milliseconds — and the
 * branches are the point, since most of them are failures that cannot
 * be produced on demand from a real Google sheet.
 *
 * The status codes are matched by VALUE rather than imported, because
 * importing them would pull the native module into Expo Go.
 */
export function googleFailureMessage(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | null | undefined;
  const code = e?.code ?? "";
  const message = e?.message ?? "";

  // A cancel is not a failure. Returning null means say nothing: the
  // user closed the sheet because they changed their mind, and an error
  // under the button would read as "that did not work" when it did
  // exactly what they asked.
  if (code === "SIGN_IN_CANCELLED" || code === "-5" || /cancel/i.test(message)) return null;
  if (code === "IN_PROGRESS") return null;

  if (/network|offline|connection/i.test(message)) {
    return "Can't reach Google. Check your connection and try again.";
  }
  // The shape of a misconfiguration: Supabase refusing the token's
  // audience, or a nonce it expected and did not get. Worth separating,
  // because the user can do nothing about it and support can.
  if (/audience|aud |invalid.*token|nonce/i.test(message)) {
    return "Google signed you in, but this app's setup rejected it. That's on us — try the emailed code instead.";
  }
  return message || "Google sign-in didn't work. Try the emailed code instead.";
}

/**
 * The same treatment for Apple, and the same reason: the branches are
 * failures that cannot be produced on demand from a real Apple sheet,
 * so they are a pure function and are tested as one.
 *
 * A CANCEL IS NOT A FAILURE and returns null — say nothing. Apple's
 * sheet is dismissed far more often than Google's, because it appears
 * over the app without a tap on an account, and a line of red under
 * the button for "I changed my mind" is wrong every time.
 */
export function appleFailureMessage(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | null | undefined;
  const code = e?.code ?? "";
  const message = e?.message ?? "";

  if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED" || /cancel/i.test(message)) return null;
  if (/network|offline|connection/i.test(message)) {
    return "Can't reach Apple. Check your connection and try again.";
  }
  // Misconfiguration, which the user can do nothing about: the wrong
  // Client ID on the Supabase provider, or a nonce it wanted and did
  // not get. Worth its own sentence so a support reply can be useful.
  if (/audience|aud |invalid.*token|nonce|client/i.test(message)) {
    return "Apple signed you in, but this app's setup rejected it. That's on us — try the emailed code instead.";
  }
  return message || "Sign in with Apple didn't work. Try the emailed code instead.";
}
