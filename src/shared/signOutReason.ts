/**
 * Whether the sign-out that just happened was asked for.
 *
 * `onAuthStateChange` fires SIGNED_OUT for two completely different
 * events: the user pressed Sign out, and the session stopped being
 * usable — a refresh token the server rejected, or a browser that
 * threw the stored session away. The app treated them identically,
 * which is why "the web signs me out every so often" arrived with no
 * evidence attached: a returning user sees the same screen either
 * way and has nothing to tell us.
 *
 * So the deliberate one is flagged, and anything else is involuntary
 * by elimination.
 *
 * ITS OWN MODULE, six lines, because the alternative is six lines
 * inside `auth.js` — which imports the Supabase client and so cannot
 * be loaded by the plain-node harness at all. An untested diagnostic
 * is worse than none here: a flag that failed to clear would report
 * every later sign-in as an expiry and send somebody hunting a bug
 * that is a Sign out button.
 */
let deliberate = false;

/** Called by `signOut()`, and by nothing else. */
export function markDeliberateSignOut(): void {
  deliberate = true;
}

/**
 * True when the session went away without anybody asking.
 *
 * Reset as it is read: the question is asked once per transition,
 * and a sticky answer would label the NEXT sign-in screen with an
 * expiry that already happened.
 */
export function takeInvoluntarySignOut(): boolean {
  const involuntary = !deliberate;
  deliberate = false;
  return involuntary;
}
