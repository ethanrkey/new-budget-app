// WHICH SESSIONS A SIGN-OUT ENDS, in one place, for both clients.
//
// THE BUG, found in the Supabase auth log on 2026-10-17:
//
//   400: Invalid Refresh Token: Refresh Token Not Found
//   (refresh_token_not_found), 19:01:22Z — and twice more that
//   afternoon.
//
// "The web signs me out every so often and iOS doesn't" had been open
// for two batches and had collected three wrong suspects: two tabs
// refreshing at once, a code path signing out on a network error, and
// Safari's seven-day cap on script-written localStorage. All three
// were ruled out by reading code, and none of them was it.
//
// `supabase.auth.signOut()` takes an options object whose default is
// `{ scope: 'global' }`, and global means EVERY session this user has,
// on every device. auth-js says so itself, in a warning above its own
// signature. So an afternoon spent signing out on the phone to test
// other accounts was an afternoon of quietly revoking the refresh
// token the browser was holding — and the browser only found out on
// its next refresh, up to an hour later, which is exactly why it
// read as random.
//
// Nothing in this app ever wanted the global scope. Signing out is a
// statement about THIS device.
//
// It is a constant in src/shared rather than a literal at each of the
// three call sites because there is no way to notice the default: a
// call with no argument looks finished, and the thing it does wrong
// happens on another device an hour later.
export const SIGN_OUT_SCOPE = { scope: "local" } as const;
