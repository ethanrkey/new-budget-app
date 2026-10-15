import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import Svg, { Path } from "react-native-svg";
import { T } from "../lib/theme";
import {
  CODE_LENGTH, codeReady, isPlausibleEmail, normalizeCode, normalizeEmail,
  resendIn, sendFailureMessage, verifyFailureMessage,
} from "../lib/signin";
import { GOOGLE_AVAILABLE, signInWithGoogle } from "../lib/google";
import { appleAvailable, signInWithApple } from "../lib/apple";
import * as feel from "../lib/haptics";

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
// THE TWO BRAND BUTTONS ARE ONE COMPONENT, since 2026-10-15. See
// BrandButton below for why that meant giving up Apple's native
// `AppleAuthenticationButton`, and what both sets of guidelines
// actually require.
//
// TAPPING ANYWHERE ELSE PUTS THE KEYBOARD AWAY. The email field
// autofocuses, so the keyboard is up before anything is typed, and
// neither keyboard here has a key that dismisses it — the email step
// asks for "go" and the code step is a number pad, which has no
// return key at all. Until now the only way off the screen was to
// submit. The whole sheet is a Pressable whose press is
// `Keyboard.dismiss`; a child that takes the touch (a field, a
// button) never lets it reach here, which is exactly the rule
// wanted.
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
    //
    // The haptics here are the one case where the phone is faster than
    // the eye: the code auto-submits on the sixth digit, so the first
    // sign that anything happened can arrive while you are still
    // looking at the keyboard. The screen change and the error line
    // still carry it; this just arrives first.
    //
    // DELIBERATELY NOT on each keystroke, and not on the auto-submit
    // itself — six buzzes to type a code is a phone having an opinion
    // about every digit.
    if (err) { feel.failure(); setError(verifyFailureMessage(err)); }
    else feel.success();
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
      style={styles.flex}
    >
      {/* The backdrop. `accessible={false}` so VoiceOver does not
          announce the whole screen as one button, and no pressed
          style, because nothing should look like it was pressed. */}
      <Pressable
        accessible={false}
        onPress={Keyboard.dismiss}
        testID="signin-backdrop"
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
          {error && <Text style={styles.err} accessibilityRole="alert">{error}</Text>}
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
          {GOOGLE_AVAILABLE && <GoogleButton onPress={google} busy={busy} />}

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
          {error && <Text style={styles.err} accessibilityRole="alert">{error}</Text>}
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
      </Pressable>
    </KeyboardAvoidingView>
  );
}

/**
 * ONE BUTTON, WORN TWICE.
 *
 * Reported from a device on build 8: "the text sizes differ and the
 * logos sit in different spots." Both were true, and the root cause
 * is that only one of the two buttons was ours.
 *
 * Google's was a Pressable: 15pt semibold label centered in the whole
 * button, with the G pinned by `position: absolute` at the leading
 * edge. Apple's was `AppleAuthenticationButton`, which is
 * `ASAuthorizationAppleIDButton` — it draws its own title in a font
 * SIZED FROM ITS OWN FRAME, with the glyph and the title centered
 * together as a group. Nothing on that view sets a font: the only
 * properties it exposes are type, style and corner radius (see
 * expo-apple-authentication's AppleAuthenticationButton.swift). So
 * "make the two match" and "keep Apple's native view" cannot both be
 * true — the native view's size is unreadable from here and unsettable
 * from anywhere.
 *
 * SO BOTH ARE CUSTOM NOW, and that is a deliberate trade worth
 * stating: a native button is compliant by construction, and a custom
 * one is compliant because somebody read the rules. Apple's
 * guidelines do allow it — they publish the logo artwork for exactly
 * this, permit adjusting the title's font weight and size, and set
 * the floor at a 140pt minimum width, a 30pt minimum height, and a
 * margin of at least one tenth of the button's height. What they do
 * NOT allow is a redrawn Apple logo, so this does not draw one: the
 * mark is `apple.logo` from SF Symbols, which is Apple's own artwork
 * rendered by the system, and the wording is one of the three
 * approved titles.
 *
 * THE LAYOUT, which is the thing both guidelines had to agree on:
 *
 *     [ 20pt mark ][ 12pt ][ 17pt/500 label ]   centered as a group
 *     50pt tall, full width, 12pt corner radius
 *
 * - Centered as a group is what Apple's own button does, and it is
 *   what Google's rendered SDK button does whenever the button is
 *   wider than its content. The old leading-edge G was the other
 *   reading of Google's diagram, and it is the one that does not
 *   match Apple.
 * - Google's iOS spec gives 16pt before the mark, 12pt between mark
 *   and label, 16pt after the label. Those are minimums for a button
 *   sized to its content; centering a group inside 50x(full width)
 *   leaves far more than 16 at each end and exactly 12 in the middle.
 * - Apple's minimum margin is height/10 = 5pt; the 20pt content in a
 *   50pt box leaves 15.
 * - 17pt at weight 500 ("Medium") is Google's 14/20 Google Sans
 *   Medium scaled to this button's height, and within what Apple
 *   permits for a custom title.
 *
 * COLORS STAY EACH BRAND'S, because that is the one thing neither
 * will bend on: Google's light theme is #FFFFFF with a 1pt #747775
 * border and a #1F1F1F label beside the unaltered four-color G;
 * Apple's white style is #FFFFFF with no border and the mark and
 * title both black. Written as literals, never theme tokens — these
 * belong to Google and to Apple, and a token someone later retunes
 * would take a button off-brand with nothing noticing.
 */
export const BRAND_BUTTON = {
  height: 50,
  radius: 12,
  mark: 20,
  gap: 12,
  fontSize: 17,
  fontWeight: "500",
} as const;

function BrandButton({
  mark, label, onPress, busy, surface, borderColor, labelColor,
}: {
  mark: React.ReactNode;
  label: string;
  onPress: () => void;
  busy: boolean;
  surface: string;
  borderColor?: string;
  labelColor: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.brandButton,
        { backgroundColor: surface },
        borderColor ? { borderWidth: 1, borderColor } : null,
        pressed && styles.brandPressed,
        busy && styles.disabled,
      ]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {mark}
      <Text style={[styles.brandLabel, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Google's four-color G, unaltered. Never recolored, never redrawn as
 * a single-color glyph — that is the usual way this goes wrong, and
 * the result still looks like a button.
 */
function GoogleMark() {
  return (
    <Svg width={BRAND_BUTTON.mark} height={BRAND_BUTTON.mark} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

function GoogleButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <BrandButton
      mark={<GoogleMark />}
      label="Continue with Google"
      onPress={onPress}
      busy={busy}
      surface="#FFFFFF"
      borderColor="#747775"
      labelColor="#1F1F1F"
    />
  );
}

/**
 * Apple's mark is APPLE'S MARK: `apple.logo` out of SF Symbols, drawn
 * by the system from Apple's own artwork. Not an SVG path somebody
 * traced — the guidelines forbid a custom Apple logo, and SF Symbols
 * is where Apple puts this one for sign-in buttons to use.
 *
 * The symbol's box is square while the glyph is taller than it is
 * wide, so it is given the label's own size rather than the mark size
 * the G uses; at 17pt the glyph stands about as tall as a capital.
 */
function AppleMark() {
  return (
    <SymbolView
      name="apple.logo"
      size={BRAND_BUTTON.fontSize}
      type="monochrome"
      tintColor="#000000"
      testID="apple-mark"
      fallback={<Text style={{ fontSize: BRAND_BUTTON.fontSize, color: "#000000" }} testID="apple-mark"></Text>}
    />
  );
}

function AppleButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <BrandButton
      mark={<AppleMark />}
      label="Continue with Apple"
      onPress={onPress}
      busy={busy}
      surface="#FFFFFF"
      labelColor="#000000"
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  // ONE SET OF METRICS FOR BOTH BRAND BUTTONS. See BrandButton.
  // `height`, not `minHeight`: a minimum is a different number on two
  // buttons whose contents differ, which is how they stopped matching.
  brandButton: {
    marginTop: 12,
    height: BRAND_BUTTON.height,
    borderRadius: BRAND_BUTTON.radius,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: BRAND_BUTTON.gap,
  },
  brandPressed: { opacity: 0.85 },
  brandLabel: { fontSize: BRAND_BUTTON.fontSize, fontWeight: BRAND_BUTTON.fontWeight },
  note: { color: T.faint, fontSize: 12, textAlign: "center", marginTop: 10, lineHeight: 17 },
});
