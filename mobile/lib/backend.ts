// What is this build actually talking to?
//
// Pure, and in its own file, so it can be tested without pulling in the
// Supabase client — the question is a string classification and should
// not need a network library to answer.
//
// THE FIRST VERSION OF THIS WAS A LIE. It inferred "fixture data" from
// "not https", which is true of `scripts/fakeSupabase.mjs` and equally
// true of a local Supabase stack on `http://localhost:54321`. That second
// case is the user's own real data, and a banner reading "not connected
// to your account" over it would be worse than no banner: a warning that
// cries wolf teaches people to ignore the one that matters.
//
// So fixture is DECLARED, not inferred. The harness sets
// EXPO_PUBLIC_FIXTURE=1 and nothing else does. The one inference kept is
// our own default port, because forgetting the flag is likely and the
// cost of that fallback is bounded: 5199 is this repo's harness port, not
// anything Supabase ships.

export type BackendKind =
  /** Real Supabase over https. No banner. */
  | "production"
  /** A local Supabase stack: real data, plain http. Worth saying quietly;
   *  must NOT claim the data is fake. */
  | "local"
  /** scripts/fakeSupabase.mjs. Invented data. Say so loudly. */
  | "fixture";

/** The harness's own port, used as a fallback signal when the flag is
 *  forgotten. Keep in step with scripts/fakeSupabase.mjs. */
const FIXTURE_PORT = "5199";

export function backendKind(url: string | undefined | null, fixtureFlag?: string | null): BackendKind {
  const u = (url ?? "").trim();
  if (fixtureFlag === "1" || fixtureFlag === "true") return "fixture";
  // Port-matched only on a loopback host: a production URL that happens to
  // carry :5199 is somebody else's problem, not a reason to call their
  // data fake.
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u) && u.includes(`:${FIXTURE_PORT}`)) {
    return "fixture";
  }
  if (/^https:\/\//i.test(u)) return "production";
  return "local";
}

/** What the banner says, or null for no banner. */
export function backendNotice(kind: BackendKind): string | null {
  if (kind === "fixture") return "FIXTURE DATA — not connected to your account";
  if (kind === "local") return "Local backend — not production";
  return null;
}
