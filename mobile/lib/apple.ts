import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { appleFailureMessage } from "./signin";
import { patchPrefs } from "./prefs";

// Sign in with Apple, natively.
//
// REQUIRED, not optional. Guideline 4.8: an app offering a third-party
// social login has to offer an equivalent that keeps the user's email
// private, and this app's own emailed-code login cannot be it, because
// it cannot hide an address. So Google shipping to the App Store
// without this is a rejection.
//
// THE FLOW NEEDS NO SERVICES ID AND NO SIGNING KEY. The native button
// talks to the OS, the OS returns an ID token whose audience is the
// BUNDLE ID, and Supabase takes it directly — `app.keybudget` is
// registered as a Client ID on the Apple provider, and that is the
// whole configuration. (The DELETION half does need the key; that is
// lib/apple.ts's other function and supabase/functions/apple-revoke.)
//
// NO NONCE, same as Google and for a documented reason rather than an
// oversight: `signInAsync` offers no way to attach one and Supabase's
// "Skip nonce checks" is on for this project.
//
// NOT IN EXPO GO. Expo Go's bundle id is host.exp.Exponent, so the OS
// would issue a token for the wrong audience and Supabase would
// rightly refuse it. Checked as a declared fact rather than discovered
// at the moment of pressing.
export const APPLE_POSSIBLE =
  Platform.OS === "ios" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

/** Does this device actually offer it? iOS 13+, and never the simulator-less case. */
export async function appleAvailable(): Promise<boolean> {
  if (!APPLE_POSSIBLE) return false;
  try {
    const AppleAuthentication = require("expo-apple-authentication");
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** The minimum of supabase-js this needs, so a test can pass a fake. */
type AuthClient = {
  auth: { signInWithIdToken: (a: { provider: string; token: string }) => Promise<{ error: unknown }> };
  functions: { invoke: (name: string, opts: { body: Record<string, string> }) => Promise<{ error: unknown }> };
};

/**
 * Sign in, and hand the authorization code to the server IMMEDIATELY.
 *
 * The second half is the part that is easy to leave out and expensive
 * to add later. Apple requires an app offering Sign in with Apple to
 * REVOKE the user's tokens when their account is deleted, and the
 * revoke endpoint wants an Apple refresh token. The only way to get
 * one is to exchange the `authorizationCode` returned here — and that
 * code EXPIRES IN FIVE MINUTES AND WORKS ONCE. So "store the code and
 * exchange it at deletion" is not a plan; it has to go to the server
 * now, be exchanged there, and the refresh token is what is kept.
 *
 * The exchange needs the `.p8` signing key, so it happens in an edge
 * function and never here: a key in a client is not a key.
 *
 * IT IS DELIBERATELY NOT AWAITED INTO THE SIGN-IN RESULT. A user who
 * has just authenticated is signed in; a failure to store a token for
 * a deletion that may never happen is not their problem and must not
 * be their error message, and the screen is gone a moment later
 * anyway — the auth listener swaps it for the app.
 *
 * BUT IT IS NO LONGER SILENT. It was, and that cost an afternoon:
 * the exchange was failing with `invalid_client` for days and the
 * only place it showed was the edge function's log. A failure now
 * sets a device preference and Settings says so in words, under the
 * account facts, where somebody looking for the state of their
 * sign-in would look. A success clears it, which is also the repair:
 * every Apple sign-in brings a fresh code and re-links.
 */
export async function signInWithApple(supabase: AuthClient): Promise<{ ok: boolean; message: string | null }> {
  // Required lazily: a top-level import is evaluated in Expo Go too,
  // where the native side does not exist.
  const AppleAuthentication = require("expo-apple-authentication");
  try {
    const credential = await AppleAuthentication.signInAsync({
      // Name and email come back ONLY on the very first authorization,
      // ever, for this Apple ID and this app. They are asked for
      // because there is no second chance to ask — not because
      // anything here needs them today.
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      return { ok: false, message: "Apple didn't return a sign-in token. Try the emailed code instead." };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
    });
    if (error) return { ok: false, message: appleFailureMessage(error) };

    if (credential.authorizationCode) {
      void linkAppleAuthorization(supabase, credential.authorizationCode);
    }
    return { ok: true, message: null };
  } catch (e) {
    return { ok: false, message: appleFailureMessage(e) };
  }
}

/**
 * Exchange happens server-side; this only hands the code over.
 *
 * Exported so the sign-in path's one unawaited call is a named thing
 * rather than an anonymous promise, and so a test can assert that it
 * was made with the code that came back.
 */
export async function linkAppleAuthorization(supabase: AuthClient, code: string): Promise<void> {
  let failed = true;
  try {
    const { error } = await supabase.functions.invoke("apple-link", { body: { code } });
    if (error) console.warn("[apple] authorization code not stored:", error);
    else failed = false;
  } catch (e) {
    console.warn("[apple] authorization code not stored:", e);
  }
  // Written either way: a success has to CLEAR a previous failure, or
  // the notice outlives the problem and becomes furniture.
  await patchPrefs({ appleLinkFailed: failed });
}
