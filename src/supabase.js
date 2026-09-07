// ---- Supabase client ----
// The one place that knows how to reach the backend. storage.js and auth.js
// both import this; nothing else should need to.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    "Missing Supabase env vars — create a .env.local with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example)."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Stay signed in across reloads/reopens until an explicit Sign Out —
    // these are actually the SDK's own defaults in a browser, but made
    // explicit here so it's not left to an implicit default that could
    // change, and so it's obvious this was a deliberate choice.
    persistSession: true, // session (and refresh token) saved to localStorage
    autoRefreshToken: true, // silently refresh the access token before it expires
    detectSessionInUrl: true, // required to complete the Google OAuth redirect back
  },
});
