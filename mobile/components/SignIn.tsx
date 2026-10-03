import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { T } from "../lib/theme";

// Email + password only. Google OAuth in Expo Go needs a redirect URI that
// survives the Expo Go sandbox — unknown cost on a night with a deadline —
// and the magic-link fallback is down behind a broken confirmation email.
export default function SignIn() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || !email || !password) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.wrap, { paddingTop: insets.top + 80, paddingBottom: insets.bottom }]}
    >
      <Text style={styles.brand}>Key Budget</Text>
      <Text style={styles.sub}>Plan your future while viewing the present</Text>

      <TextInput
        style={styles.field}
        placeholder="Email"
        placeholderTextColor={T.faint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.field}
        placeholder="Password"
        placeholderTextColor={T.faint}
        secureTextEntry
        textContentType="password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        returnKeyType="go"
      />

      {error && <Text style={styles.err}>{error}</Text>}

      <Pressable
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        onPress={submit}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.ctaText}>Sign in</Text>}
      </Pressable>
      <Text style={styles.note}>Read-only on mobile for now.</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 24, gap: 12 },
  brand: { color: T.brass, fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  sub: { color: T.dim, marginBottom: 20 },
  field: {
    backgroundColor: T.surface, borderColor: T.border, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, color: T.text, fontSize: 16,
  },
  err: { color: T.expense },
  cta: {
    backgroundColor: T.brass, borderRadius: 12, paddingVertical: 15,
    alignItems: "center", marginTop: 8, minHeight: 50, justifyContent: "center",
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: { color: "#111827", fontWeight: "700", fontSize: 16 },
  note: { color: T.faint, fontSize: 12, textAlign: "center", marginTop: 6 },
});
