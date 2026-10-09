import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { T } from "../lib/theme";
import {
  CODE_LENGTH, codeReady, isPlausibleEmail, normalizeCode, normalizeEmail,
  resendIn, sendFailureMessage, verifyFailureMessage,
} from "../lib/signin";

// Sign in by emailed code. Two steps, because a code you have not been
// sent yet is not a field you should be looking at.
//
// This replaced email + password, which could let in exactly one account:
// the web has only ever created accounts through Google or a magic link,
// and neither sets a password, so every real user was locked out of the
// phone while the screen looked like it worked. A code reaches all of
// them — it authenticates the address, which is the one thing every
// account here has.
//
// GOOGLE AND SIGN IN WITH APPLE ARE NOT HERE YET, and the reason is a
// build, not a decision. Both hand control to a browser or a system sheet
// and need it handed back through a registered URL scheme, which Expo Go
// cannot provide — it is a different app with a different scheme. They
// land when there is a development build to put them in, and Sign in with
// Apple additionally needs the paid Apple Developer account for its
// Service ID and key. Apple's guideline 4.8 ties them together: offering
// Google obliges an equivalent option, and this app's own email login
// cannot be it, because it cannot keep an address private. See the spec.
export default function SignIn() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeField = useRef<TextInput>(null);

  // A countdown rather than a disabled button with no explanation: the
  // one-per-minute limit is Supabase's, and a button that does nothing
  // for a reason it will not state is how people conclude an app is
  // broken and try again harder.
  useEffect(() => {
    if (sentAt == null) return;
    const tick = () => setCooldown(resendIn(sentAt, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  const clean = normalizeEmail(email);

  async function send(resending = false) {
    if (busy || !isPlausibleEmail(clean)) return;
    setBusy(true);
    setError(null);
    // shouldCreateUser false: this is a sign-IN screen. Signing up happens
    // on the web, where the first-run setup lives, and a phone that
    // silently minted an account for a typo'd address would strand data
    // under a user nobody can reach.
    const { error: err } = await supabase.auth.signInWithOtp({
      email: clean,
      options: { shouldCreateUser: false },
    });
    const blocked = sendFailureMessage(err);
    setBusy(false);
    if (blocked) { setError(blocked); return; }
    setSentAt(Date.now());
    if (!resending) { setCode(""); setStep("code"); }
    setTimeout(() => codeField.current?.focus(), 0);
  }

  async function verify() {
    if (busy || !codeReady(code)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: clean,
      token: normalizeCode(code),
      type: "email",
    });
    setBusy(false);
    // On success there is nothing to do: the auth listener swaps this
    // screen for the app. Only the failure needs saying.
    if (err) setError(verifyFailureMessage(err));
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.wrap, { paddingTop: insets.top + 80, paddingBottom: insets.bottom }]}
    >
      <Text style={styles.brand}>Key Budget</Text>
      <Text style={styles.sub}>Plan your future while viewing the present</Text>

      {step === "email" ? (
        <>
          <TextInput
            style={styles.field}
            placeholder="you@example.com"
            placeholderTextColor={T.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => send()}
            returnKeyType="go"
            autoFocus
          />
          {error && <Text style={styles.err}>{error}</Text>}
          <Pressable
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed, (busy || !isPlausibleEmail(clean)) && styles.disabled]}
            onPress={() => send()}
            disabled={busy || !isPlausibleEmail(clean)}
            accessibilityRole="button"
            accessibilityLabel="Email me a code"
          >
            {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.ctaText}>Email me a code</Text>}
          </Pressable>
          <Text style={styles.note}>
            No password. We email a six-digit code to the address on your account — the same account as
            the web.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.sent}>
            If <Text style={styles.strong}>{clean}</Text> has an account, a {CODE_LENGTH}-digit code is on
            its way. It expires in an hour.
          </Text>
          <TextInput
            ref={codeField}
            style={[styles.field, styles.codeField]}
            placeholder="000000"
            placeholderTextColor={T.faint}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            value={code}
            onChangeText={(raw) => setCode(normalizeCode(raw))}
            onSubmitEditing={verify}
            returnKeyType="go"
          />
          {error && <Text style={styles.err}>{error}</Text>}
          <Pressable
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed, (busy || !codeReady(code)) && styles.disabled]}
            onPress={verify}
            disabled={busy || !codeReady(code)}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
          >
            {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.ctaText}>Sign in</Text>}
          </Pressable>

          <View style={styles.row}>
            <Pressable onPress={() => { setStep("email"); setError(null); }} accessibilityRole="button" accessibilityLabel="Use a different address">
              <Text style={styles.link}>Use a different address</Text>
            </Pressable>
            <Pressable onPress={() => send(true)} disabled={busy || cooldown > 0} accessibilityRole="button" accessibilityLabel="Resend the code">
              <Text style={[styles.link, (busy || cooldown > 0) && styles.linkOff]}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend the code"}
              </Text>
            </Pressable>
          </View>

          {/* The honest dead end. An account created with Google may not
              be reachable by email code, and if that is what happened the
              screen must not just sit there looking patient. */}
          <Text style={styles.note}>
            Nothing arriving? Check spam first. If you signed up with Google, sign in on the web at
            keybudget.app — the phone cannot do Google yet.
          </Text>
        </>
      )}
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
  codeField: { fontSize: 28, letterSpacing: 8, textAlign: "center", fontVariant: ["tabular-nums"] },
  sent: { color: T.dim, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  strong: { color: T.text, fontWeight: "600" },
  err: { color: T.expense },
  cta: {
    backgroundColor: T.brass, borderRadius: 12, paddingVertical: 15,
    alignItems: "center", marginTop: 8, minHeight: 50, justifyContent: "center",
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: { color: "#111827", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.4 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  link: { color: T.brass, fontSize: 14 },
  linkOff: { color: T.faint },
  note: { color: T.faint, fontSize: 12, textAlign: "center", marginTop: 10, lineHeight: 17 },
});
