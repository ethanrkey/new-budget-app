// ---- Auth: Google OAuth (primary) + email magic link (fallback) ----
import { supabase } from "./supabase.js";

// Redirects the browser to Google, then back to this app once signed in.
export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
}

// Emails a one-click sign-in link.
export function signInWithMagicLink(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
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
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}
