import { useEffect, useRef, useState } from "react";
import { signInWithGoogle, signInWithMagicLink, verifyEmailCode } from "../auth.js";
import {
  CODE_LENGTH, codeReady, isPlausibleEmail, normalizeCode, normalizeEmail,
  resendIn, sendFailureMessage, verifyFailureMessage,
} from "../shared/signin.ts";

// THE EMAIL HAS ALWAYS CARRIED BOTH. `{{ .ConfirmationURL }}` and
// `{{ .Token }}` sit side by side in the templates, and until
// 2026-10-14 this screen knew only about the link — so a new user,
// who gets the "Confirm signup" template, was handed six digits with
// nowhere on the site to type them. The phone has taken the code
// since October; this is the same two-step flow, from the same
// functions in src/signin.ts, so neither client can drift on what
// counts as a valid code or on what a failure says.
//
// The link still works and is still offered first. A code is the
// answer to the case the link cannot fix: a link opens in whatever
// browser the mail app hands it to, which is routinely not the one
// that asked for it, and the session lands in the wrong browser.

/**
 * @param {{ expired?: boolean }} props `expired` when the last session
 *   ended without anybody pressing Sign out.
 */
export default function SignIn({ expired = false }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  // The last code this screen has already tried. Auto-submit fires once
  // per distinct code and never again for the same one, so a rejected
  // code is not re-sent forever while the user looks at it.
  const attempted = useRef(null);

  // A countdown rather than a dead button: the one-per-minute limit is
  // Supabase's, and a control that does nothing for a reason it will
  // not state is how people conclude a site is broken.
  useEffect(() => {
    if (sentAt == null) return;
    const tick = () => setCooldown(resendIn(sentAt, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  const clean = normalizeEmail(email);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  }

  async function handleGoogle() {
    setError("");
    setBusy(true);
    const { error } = await signInWithGoogle();
    // on success the browser navigates away to Google, so only handle the error case
    if (error) { setError(error.message); setBusy(false); }
  }

  async function handleMagicLink(e) {
    e?.preventDefault();
    if (!isPlausibleEmail(clean) || busy) return;
    setError("");
    setBusy(true);
    const { error } = await signInWithMagicLink(clean);
    setBusy(false);
    // Shared with the phone: a rate limit and a dead network are
    // spoken, and "no account here" is NOT, because an error that
    // distinguishes it is an account-enumeration oracle.
    const blocked = sendFailureMessage(error);
    if (blocked) { setError(blocked); return; }
    // Cleared on every send, resend included: the previous code is dead
    // the moment a new one is issued.
    setCode("");
    attempted.current = null;
    setSentAt(Date.now());
    setSent(true);
  }

  async function verify(entered) {
    const token = normalizeCode(entered ?? code);
    if (busy || !codeReady(token)) return;
    attempted.current = token;
    setError("");
    setBusy(true);
    const { error } = await verifyEmailCode(clean, token);
    setBusy(false);
    // On success onAuthChange swaps the screen; only failure needs saying.
    if (error) setError(verifyFailureMessage(error));
  }

  // Submit on the sixth digit, however it arrived — typed, pasted, or
  // dropped in by the browser's one-time-code autofill. Done in the
  // change handler rather than an effect, exactly as on the phone: an
  // effect would also run when `busy` flips back after a rejection, so
  // every guard against resending a dead code would be a guard against
  // an infinite loop.
  function onCodeChange(raw) {
    const next = normalizeCode(raw);
    setCode(next);
    if (next.length === CODE_LENGTH && !busy && next !== attempted.current) void verify(next);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 px-4">
      <button
        onClick={toggleTheme}
        className="fixed top-4 right-4 text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
      >
        {dark ? "☀ Light" : "🌙 Dark"}
      </button>

      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl p-8 shadow-xl border border-gray-200 dark:border-gray-800">
        <h1 className="text-xl font-semibold tracking-tight text-center mb-1">Key Budget</h1>
        <p className="text-sm text-gray-500 text-center mb-6">Sign in to load your ledger &amp; budget.</p>

        {/* SAY WHICH OF THE TWO THINGS HAPPENED. Pressing Sign out and
            having a session stop working land on this identical
            screen, and the second one is the whole of the report
            "the web signs me out every so often" — a sentence nobody
            could have written with more detail, because the app gave
            them none. */}
        {expired && (
          <p className="text-sm text-center mb-6 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-gray-600 dark:text-gray-300">
            Your session ended and you were signed out. Nothing was lost — sign in again to pick up
            where you left off.
          </p>
        )}

        <button
          onClick={handleGoogle}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="flex items-center gap-3 my-5">
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
          <span className="text-xs text-gray-400">or</span>
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
        </div>

        {sent ? (
          <div className="space-y-3">
            <p className="text-sm text-center text-gray-500">
              Check <span className="font-medium text-gray-900 dark:text-gray-100">{clean}</span>.
              Click the link in the email, or type the {CODE_LENGTH}-digit code from it here.
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              placeholder="000000"
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-2xl tracking-[0.5em] text-center tabular-nums"
            />
            <button
              onClick={() => verify()}
              disabled={busy || !codeReady(code)}
              className="w-full py-2.5 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition"
            >
              Sign in
            </button>
            <div className="flex items-center justify-between text-sm">
              <button
                onClick={() => { setSent(false); setError(""); attempted.current = null; }}
                className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Use a different address
              </button>
              <button
                onClick={() => handleMagicLink()}
                disabled={busy || cooldown > 0}
                className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:text-gray-300 dark:disabled:text-gray-700"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend"}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleMagicLink} className="space-y-3">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition"
            >
              Email me a link and a code
            </button>
          </form>
        )}

        {error && <p className="mt-4 text-sm text-expense text-center">{error}</p>}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.02l7.73 6c4.51-4.18 7.09-10.36 7.09-17.49z"/>
      <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 019.5 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.94 23.94 0 000 24c0 3.87.92 7.53 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
