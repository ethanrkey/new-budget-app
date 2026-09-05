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

export const supabase = createClient(url, anonKey);
