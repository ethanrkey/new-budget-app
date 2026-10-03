// The same Supabase project as the web app, same anon key, same RLS.
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// EXPO_PUBLIC_* is inlined at build time, exactly like Vite's VITE_*. The
// anon key is public by design — RLS is the security model, audited
// 2026-10-02, and `budget_entities` enforces auth.uid() = user_id on every
// policy. A phone holding this key can read nothing but its own rows.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anon, {
  auth: {
    // AsyncStorage, not SecureStore: a Supabase session exceeds iOS
    // SecureStore's 2048-byte per-value limit and would need chunking.
    // Worth doing before this is on anyone else's phone; not worth it for
    // a build whose question is "does it feel like an app".
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // No OAuth redirect to catch in Expo Go — email + password only here.
    detectSessionInUrl: false,
  },
});
