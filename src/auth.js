// @ts-check
// ---- Auth: Google OAuth (primary) + email magic link (fallback) ----
import { supabase } from "./supabase.js";

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

// Emails a one-click sign-in link.
/** @param {string} email */
export function signInWithMagicLink(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: APP_URL },
  });
}

export function signOut() {
  return supabase.auth.signOut();
}

// The current session, once, at load — null if signed out.
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("getSession failed", error);
  return data?.session ?? null;
}

// Fires on sign-in, sign-out, and token refresh. Returns an unsubscribe fn.
/** @param {(session: import("@supabase/supabase-js").Session | null) => void} callback */
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}
