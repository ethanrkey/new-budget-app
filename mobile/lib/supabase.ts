// The same Supabase project as the web app, same anon key, same RLS.
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { backendKind, backendNotice } from "./backend";

// EXPO_PUBLIC_* is inlined at build time, exactly like Vite's VITE_*. The
// anon key is public by design — RLS is the security model, audited
// 2026-10-02, and `budget_entities` enforces auth.uid() = user_id on every
// policy. A phone holding this key can read nothing but its own rows.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// SAY WHICH VARIABLE, AND WHERE IT COMES FROM.
//
// These are inlined at build time, so a build made without them produces
// an app that dies on launch — and what it said was "supabaseUrl is
// required", thrown from inside supabase-js, with nothing naming the
// variable or the place to set it. That was the first EAS build: the
// pipeline worked perfectly and the binary crashed before its first
// frame, because `mobile/.env` is gitignored and EAS only uploads what
// git tracks. Nothing was wrong with the build; the values simply were
// not there, and the crash said none of that.
//
// Still fatal, deliberately: an app that cannot reach its backend has
// nothing honest to show. But a fatal error is allowed to be legible.
if (!url || !anon) {
  const missing = [!url && "EXPO_PUBLIC_SUPABASE_URL", !anon && "EXPO_PUBLIC_SUPABASE_ANON_KEY"]
    .filter(Boolean).join(" and ");
  throw new Error(
    `${missing} is missing from this bundle. Locally that means mobile/.env; ` +
    "in an EAS build it means the project's environment variables, which are " +
    "separate from .env because .env is gitignored and never uploaded."
  );
}

export const supabase = createClient(url, anon, {
  auth: {
    // AsyncStorage, not SecureStore: a Supabase session exceeds iOS
    // SecureStore's 2048-byte per-value limit and would need chunking.
    // Worth doing before this is on anyone else's phone; not worth it for
    // a build whose question is "does it feel like an app".
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Nothing to catch in a URL: sign-in is an emailed six-digit code,
    // typed into the app, so no redirect ever comes back. This flips to
    // true the day Google or Sign in with Apple lands, which needs a
    // development build and a registered scheme — see components/SignIn.
    detectSessionInUrl: false,
  },
});

// Which backend this build is wired to, and the banner for it. The
// reason this is a DECLARED flag rather than "is the URL https" is in
// lib/backend.ts: the inference called a local Supabase stack fake data.
//
// Why it matters at all: the harness is switched on with
// EXPO_PUBLIC_SUPABASE_URL, and Expo reads env once at METRO START and
// inlines EXPO_PUBLIC_* into the bundle as literals. Deleting the
// .env.local afterwards changes nothing — the running server keeps
// serving a bundle with the harness URL baked in, and a physical phone
// resolves localhost to itself and fails to connect with no clue why.
// Killing Metro is the teardown. The banner is so the app says this out
// loud instead of looking broken.
export const BACKEND = backendKind(url, process.env.EXPO_PUBLIC_FIXTURE);
export const BACKEND_NOTICE = backendNotice(BACKEND);
