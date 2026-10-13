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
import { GOOGLE_AVAILABLE, signInWithGoogle } from "../lib/google";
import { APPLE_POSSIBLE, appleAvailable, signInWithApple } from "../lib/apple";

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
// GOOGLE AND APPLE ARE BOTH HERE IN A REAL BUILD AND ABSENT IN EXPO GO,
// which is a fact about the binary rather than a feature flag: neither
// native module is in Expo Go, and Expo Go's bundle id is
// host.exp.Exponent, so an Apple token issued there would have the
// wrong audience and be rightly refused.
//
// APPLE IS NOT OPTIONAL NEXT TO GOOGLE. Guideline 4.8 requires an
// equivalent login that keeps the user's email private, and this app's
// own emailed-code login cannot be it — it authenticates an address,
// which means it has one. So the two ship together or Google does not
// ship.
//
// APPLE'S BUTTON IS APPLE'S BUTTON — `AppleAuthenticationButton`, the
// real native one, not a black rectangle with a glyph on it. Apple's
// Human Interface Guidelines are specific about its appearance and a
// hand-drawn copy is a review risk for no gain.
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
  // The last code this screen has already tried. Auto-submit fires once
  // per distinct code and never again for the same one, which is what
  // keeps a rejected code from being re-sent forever while the user looks
  // at it.
  const attempted = useRef<string | null>(null);
  // Asked of the OS rather than assumed: `isAvailableAsync` is the only
  // honest answer on a device, and it is async, so it lands after the
  // first render and the button appears when it does.
  const [appleReady, setAppleReady] = useState(false);
  useEffect(() => { let dead = false; void appleAvailable().then((v) => { if (!dead) setAppleReady(v); }); return () => { dead = true; }; }, []);

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
    // Clear on EVERY send, including a resend: the previous code is dead
    // the moment a new one is issued, and leaving six stale digits in the
    // field is both a thing to delete by hand and a code the auto-submit
    // has already tried and will not try again.
    setCode("");
    attempted.current = null;
    if (!resending) setStep("code");
    setTimeout(() => codeField.current?.focus(), 0);
  }

  // `entered` lets the auto-submit pass the digit it just received:
  // `setCode` has not landed in state yet at that moment, and reading
  // the stale value would verify five digits.
  async function google() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { message } = await signInWithGoogle(supabase);
    setBusy(false);
    // null means the sheet was dismissed, which is not a failure and is
    // not worth a line of red under the button.
    if (message) setError(message);
  }

  async function apple() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { message } = await signInWithApple(supabase);
    setBusy(false);
    // null means the sheet was dismissed. Not a failure, not a message.
    if (message) setError(message);
  }

  async function verify(entered?: string) {
    const token = normalizeCode(entered ?? code);
    if (busy || !codeReady(token)) return;
    attempted.current = token;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: clean,
      token,
      type: "email",
    });
    setBusy(false);
    // On success there is nothing to do: the auth listener swaps this
    // screen for the app. Only the failure needs saying.
    if (err) setError(verifyFailureMessage(err));
  }

  // Submit on the sixth digit, however it arrived — typed, pasted, or
  // dropped in whole by the iOS one-time-code keyboard suggestion. A
  // six-digit field has exactly one thing you can do when it is full, and
  // making the user find a button afterward is a step that exists only
  // because the screen did not notice.
  //
  // Done here rather than in an effect on `code` DELIBERATELY. An effect
  // would also run when `busy` flips back after a rejection, so every
  // guard against re-sending a dead code would be a guard against an
  // infinite loop — one bad edit away from the app hammering the auth
  // endpoint. A change handler only runs when something changed, so the
  // loop cannot exist to be guarded against.
  //
  // The button stays, and it is not decoration: a code that was rejected
  // is still sitting in the field, `attempted` already holds it, and
  // auto-submit will correctly refuse to send it again. Pressing is how
  // you retry the same digits — after a resend, or when the first attempt
  // failed for a reason that has since passed.
  function onCodeChange(raw: string) {
    const next = normalizeCode(raw);
    setCode(next);
    if (next.length === CODE_LENGTH && !busy && next !== attempted.current) {
      void verify(next);
    }
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
          {(GOOGLE_AVAILABLE || appleReady) && (
            <View style={styles.orRow}>
              <View style={styles.rule} />
              <Text style={styles.or}>or</Text>
              <View style={styles.rule} />
            </View>
          )}
          {/* Apple first, and above Google rather than below it.
              Guideline 4.8 asks for an equivalent option, and an
              option listed last reads as the lesser one. */}
          {appleReady && <AppleButton onPress={apple} busy={busy} />}
          {GOOGLE_AVAILABLE && (
            <Pressable
              style={({ pressed }) => [styles.google, pressed && styles.ctaPressed, busy && styles.disabled]}
              onPress={google}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              <Text style={styles.googleText}>Continue with Google</Text>
            </Pressable>
          )}

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
            onChangeText={onCodeChange}
            onSubmitEditing={() => verify()}
            returnKeyType="go"
          />
          {error && <Text style={styles.err}>{error}</Text>}
          <Pressable
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed, (busy || !codeReady(code)) && styles.disabled]}
            onPress={() => verify()}
            disabled={busy || !codeReady(code)}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
          >
            {busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.ctaText}>Sign in</Text>}
          </Pressable>

          <View style={styles.row}>
            <Pressable onPress={() => { setStep("email"); setError(null); attempted.current = null; }} accessibilityRole="button" accessibilityLabel="Use a different address">
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
            Nothing arriving? Check spam first. If you signed up with Google or Apple, go back and use
            that button instead — both work here.
          </Text>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

/**
 * Apple's own button, required lazily.
 *
 * A top-level import of expo-apple-authentication is evaluated in Expo
 * Go, where the native view does not exist — and the import, not the
 * press, is what fails. `appleReady` is false there, so this component
 * is never rendered and the require never runs.
 */
function AppleButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  const AppleAuthentication = require("expo-apple-authentication");
  return (
    <View style={[styles.appleWrap, busy && styles.disabled]} pointerEvents={busy ? "none" : "auto"}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        // WHITE on a dark app, because the app is dark. Apple allows
        // black, white and white-with-outline; black on #030712 is a
        // button you cannot see.
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={12}
        style={styles.apple}
        onPress={onPress}
      />
    </View>
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
  orRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 },
  rule: { flex: 1, height: 1, backgroundColor: T.border },
  or: { color: T.faint, fontSize: 12 },
  appleWrap: { marginTop: 12 },
  // 50pt to match the other two buttons exactly. Apple's button draws
  // itself; only its box is ours.
  apple: { height: 50, width: "100%" },
  google: {
    marginTop: 12, minHeight: 50, borderRadius: 12, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: T.border, backgroundColor: T.surface,
  },
  googleText: { color: T.text, fontSize: 15, fontWeight: "600" },
  note: { color: T.faint, fontSize: 12, textAlign: "center", marginTop: 10, lineHeight: 17 },
});
