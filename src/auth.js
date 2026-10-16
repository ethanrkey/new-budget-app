// @ts-check
// ---- Auth: Google OAuth (primary) + email magic link (fallback) ----
import { supabase } from "./supabase.js";
import { markDeliberateSignOut } from "./shared/signOutReason.ts";

// Where OAuth and magic links come back to. NOT window.location.origin:
// since 2026-10-02 that is the public landing page, and a user who just
// signed in would land on a marketing page with a Try button. The app
// lives at /app.
const APP_URL = `${window.location.origin}/app`;

// Redirects the browser to Google, then back to this app once signed in.
export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: APP_URL },
  });
}

// Emails a one-click sign-in link AND a six-digit code — one email,
// both credentials, because the templates carry `{{ .ConfirmationURL }}`
// and `{{ .Token }}` side by side. Which one gets used is the user's
// choice, and until 2026-10-14 this screen only knew about the link.
/** @param {string} email */
export function signInWithMagicLink(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: APP_URL },
  });
}

/**
 * Sign in with the code from that email instead of the link.
 *
 * WHY THE WEB NEEDS THIS AT ALL, when it has had a working link for a
 * year: a link opens in whatever browser the mail app hands it to,
 * which is routinely not the one that asked for it, and the session
 * then lands in the wrong browser. And a brand-new web user gets the
 * "Confirm signup" template, which carries the code — so until now
 * they were handed six digits with nowhere on the site to type them.
 *
 * `type: "email"` covers both templates: signup confirmation and
 * magic link issue the same kind of OTP.
 *
 * @param {string} email
 * @param {string} token
 */
export function verifyEmailCode(email, token) {
  return supabase.auth.verifyOtp({ email, token, type: "email" });
}

// The deliberate sign-out is flagged so the involuntary one can be
// told apart from it — see src/shared/signOutReason.ts, which is a
// separate module precisely so it can be tested without this one's
// Supabase client.
export function signOut() {
  markDeliberateSignOut();
  return supabase.auth.signOut();
}

export { takeInvoluntarySignOut } from "./shared/signOutReason.ts";

// The current session, once, at load — null if signed out.
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("getSession failed", error);
  return data?.session ?? null;
}

// Fires on sign-in, sign-out, and token refresh. Returns an unsubscribe fn.
//
// The EVENT is passed on as well as the session, because SIGNED_OUT
// is the one that needs telling apart from "there was never a
// session" — see takeInvoluntarySignOut.
/** @param {(session: import("@supabase/supabase-js").Session | null, event: string) => void} callback */
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session, event);
  });
  return () => data.subscription.unsubscribe();
}
