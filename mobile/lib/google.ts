import Constants, { ExecutionEnvironment } from "expo-constants";
import { googleFailureMessage } from "./signin";

// Sign in with Google, natively.
//
// Google issues an ID token on the device and Supabase takes it directly
// (`signInWithIdToken`). No browser, no redirect to catch, no URL scheme
// round trip — which is exactly the cost that kept OAuth off the phone
// while Expo Go was the only client. It also means the user gets the
// real iOS Google sheet rather than a web view pretending to be one.
//
// NOT AVAILABLE IN EXPO GO, and that is checked rather than discovered.
// The native module is not in Expo Go's binary, so the call would throw
// at the moment of pressing — the worst time. `executionEnvironment` is
// a declared fact from expo-constants, so the button simply is not
// drawn there, and the phone's Expo Go workflow is untouched.
export const GOOGLE_AVAILABLE =
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

/**
 * The iOS OAuth client for bundle id `app.keybudget`, from the existing
 * `budget-app` Google Cloud project (225819918731) that the web has used
 * since September. Registered in Supabase's Google provider alongside
 * the web client, which is what lets Supabase accept a token whose
 * audience is this iOS client.
 *
 * Public by nature: a client ID is in the app binary and in every
 * request. The client SECRET is a web-only concept and is not here.
 */
export const IOS_CLIENT_ID =
  "225819918731-h8uii8j71melja4strfhfvvnlcc4pnsf.apps.googleusercontent.com";

/**
 * The real thing. Separated from the message mapping above so the half
 * that can be tested without a device is tested without one.
 *
 * NO NONCE, and it is not an oversight — see the spec. The library
 * exposes no way to supply one: `SignInParams` has exactly one field,
 * `loginHint`, and the string "nonce" does not appear anywhere in the
 * package. So the ID token carries no nonce claim and there is nothing
 * to hand `signInWithIdToken`. Supabase's "Skip nonce checks" has to be
 * ON for this path.
 */
export async function signInWithGoogle(
  supabase: { auth: { signInWithIdToken: (a: { provider: string; token: string }) => Promise<{ error: unknown }> } },
): Promise<{ ok: boolean; message: string | null }> {
  // Required lazily: a top-level import would be evaluated in Expo Go
  // too, where the native side does not exist.
  const g = require("@react-native-google-signin/google-signin");
  try {
    g.GoogleSignin.configure({ iosClientId: IOS_CLIENT_ID });
    await g.GoogleSignin.hasPlayServices();
    const response = await g.GoogleSignin.signIn();

    // v16 returns a tagged response rather than throwing on cancel.
    if (g.isCancelledResponse?.(response)) return { ok: false, message: null };
    const idToken = response?.data?.idToken ?? response?.idToken;
    if (!idToken) {
      return { ok: false, message: "Google didn't return a sign-in token. Try the emailed code instead." };
    }

    const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: idToken });
    if (error) return { ok: false, message: googleFailureMessage(error) };
    // On success the auth listener swaps the screen; nothing to do here.
    return { ok: true, message: null };
  } catch (e) {
    return { ok: false, message: googleFailureMessage(e) };
  }
}
