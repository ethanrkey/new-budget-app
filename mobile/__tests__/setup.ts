// Native modules the sheets touch, stubbed to the smallest thing that
// makes them real enough to press.
// RNTL v13+ ships its matchers by default; no extend-expect import.

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

jest.mock("@react-native-community/netinfo", () => ({
  addEventListener: () => () => {},
  fetch: async () => ({ isConnected: true }),
}));

// The date picker is a native view, but WHETHER IT IS ON SCREEN is the
// thing a dismissal test asserts, so it is faked as a real element with a
// label — and its last props are captured so a test can fire the change
// the native picker would have fired.
export const pickerProps: { current: Record<string, unknown> | null } = { current: null };
jest.mock("@react-native-community/datetimepicker", () => {
  const React = require("react");
  const { View } = require("react-native");
  const { pickerProps: slot } = require("./setup");
  return function MockDateTimePicker(props: Record<string, unknown>) {
    slot.current = props;
    return React.createElement(View, { accessibilityLabel: "Date picker" });
  };
});

// Supabase auth, recorded rather than stubbed silently. The sign-in tests
// assert WHAT REACHED the client, so the mock keeps every call and lets a
// test arm the next failure — which is the only way to exercise the
// anti-enumeration branch and the rate-limit branch, neither of which can
// be produced by a real server on demand.
export const authCalls: {
  otp: unknown[];
  verify: unknown[];
  // `status` is optional on purpose: supabase-js reports a dead network
  // as a fetch failure with no HTTP status at all, and that absence is
  // exactly what the offline branch keys on.
  nextOtpError: { message: string; status?: number; code?: string } | null;
  nextVerifyError: { message: string; status?: number; code?: string } | null;
  /** Tokens handed to signInWithIdToken: {provider, token}. */
  idTokens: { provider: string; token: string }[];
  nextIdTokenError: { message: string; code?: string } | null;
  /** Edge-function calls: the Apple authorization code goes through here. */
  functions: { name: string; body: unknown }[];
} = {
  otp: [], verify: [], nextOtpError: null, nextVerifyError: null,
  idTokens: [], nextIdTokenError: null, functions: [],
};

jest.mock("../lib/supabase", () => {
  const { authCalls: calls } = require("./setup");
  return {
    supabase: {
      auth: {
        signInWithOtp: async (args: unknown) => {
          calls.otp.push(args);
          const error = calls.nextOtpError;
          calls.nextOtpError = null;
          return { data: {}, error };
        },
        verifyOtp: async (args: unknown) => {
          calls.verify.push(args);
          const error = calls.nextVerifyError;
          calls.nextVerifyError = null;
          return { data: {}, error };
        },
        signInWithPassword: async () => ({ data: {}, error: null }),
        signInWithIdToken: async (args: { provider: string; token: string }) => {
          calls.idTokens.push(args);
          const error = calls.nextIdTokenError;
          calls.nextIdTokenError = null;
          return { data: {}, error };
        },
      },
      functions: {
        invoke: async (name: string, opts: { body: unknown }) => {
          calls.functions.push({ name, body: opts.body });
          return { data: {}, error: null };
        },
      },
    },
    BACKEND: "production",
    BACKEND_NOTICE: null,
  };
});

// Safe-area insets. The real provider measures a native view that does not
// exist under jest, so `useSafeAreaInsets` throws outside one. Fixed
// numbers are honest here: no test asserts a layout offset, and a test
// that did would be asserting the simulator's notch rather than the app.
jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
  };
});

// The share path, recorded. The export bug was that the CSV went out as
// a bare string, so iOS saved it as a file called `text` with no
// extension — the name and the type ARE the feature, which makes them
// worth asserting rather than mocking away silently.
export const shared: {
  files: { path: string; body: string }[];
  calls: { uri: string; options: Record<string, unknown> }[];
  available: boolean;
} = { files: [], calls: [], available: true };

jest.mock("expo-file-system", () => {
  const { shared: s } = require("./setup");
  class File {
    path: string;
    constructor(dir: { uri: string }, name: string) { this.path = `${dir.uri}${name}`; }
    get uri() { return this.path; }
    delete() { /* nothing written yet in a test */ }
    create() { s.files.push({ path: this.path, body: "" }); }
    write(body: string) { s.files[s.files.length - 1]!.body = body; }
  }
  return { File, Paths: { cache: { uri: "file:///cache/" }, document: { uri: "file:///docs/" } } };
});

jest.mock("expo-sharing", () => {
  const { shared: s } = require("./setup");
  return {
    isAvailableAsync: async () => s.available,
    shareAsync: async (uri: string, options: Record<string, unknown>) => { s.calls.push({ uri, options }); },
  };
});

// Expo Go has no Google native module, so the button must not be drawn
// there. Under jest the execution environment is neither, so it is
// pinned to a bare build — the state a dev build and TestFlight are in.
jest.mock("expo-constants", () => ({
  __esModule: true,
  ExecutionEnvironment: { Bare: "bare", Standalone: "standalone", StoreClient: "storeClient" },
  default: { executionEnvironment: "bare" },
}));

// Google sign-in, recorded. The native sheet cannot be driven under
// jest, so what is tested is the wiring either side of it: is the
// button drawn, does pressing it call through, and is a returned
// message shown — including the case where the answer is "say nothing",
// which is what a dismissed sheet has to look like.
export const googleCalls: { count: number; next: { ok: boolean; message: string | null } } = {
  count: 0,
  next: { ok: true, message: null },
};

jest.mock("../lib/google", () => {
  const { googleCalls: g } = require("./setup");
  return {
    GOOGLE_AVAILABLE: true,
    IOS_CLIENT_ID: "test.apps.googleusercontent.com",
    signInWithGoogle: async () => { g.count++; return g.next; },
  };
});

// Sign in with Apple, recorded. Same reasoning as the Google mock: the
// OS sheet cannot be driven under jest, so what is tested is the
// wiring either side of it — is Apple's own button drawn, does
// pressing it call through, is the authorization code handed to the
// server immediately, and does a dismissal say nothing.
//
// `isAvailableAsync` is a function rather than a constant because the
// screen ASKS the OS and renders the button when the answer lands,
// which is a thing a test needs to be able to answer no to.
export const appleCalls: {
  available: boolean;
  signIns: number;
  next: {
    identityToken: string | null;
    authorizationCode: string | null;
    error: { code?: string; message?: string } | null;
  };
} = {
  available: true,
  signIns: 0,
  next: { identityToken: "apple.id.token", authorizationCode: "apple-auth-code", error: null },
};

jest.mock("expo-apple-authentication", () => {
  const React = require("react");
  const { Pressable, Text } = require("react-native");
  const { appleCalls: a } = require("./setup");
  return {
    isAvailableAsync: async () => a.available,
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 1 },
    signInAsync: async () => {
      a.signIns++;
      if (a.next.error) throw a.next.error;
      return { identityToken: a.next.identityToken, authorizationCode: a.next.authorizationCode };
    },
    // Apple's own view, stood in for by something pressable that
    // carries the same label the real one exposes to VoiceOver.
    AppleAuthenticationButton: (props: Record<string, unknown>) =>
      React.createElement(
        Pressable,
        { onPress: props.onPress, accessibilityRole: "button", accessibilityLabel: "Continue with Apple" },
        React.createElement(Text, null, "Continue with Apple")
      ),
  };
});

// Haptics, recorded. A buzz is the one thing in this app that leaves
// no trace on the screen and cannot be looked at on a simulator, so
// the only way to know the wiring is right — and that nothing fires
// twice, or on every keystroke — is to record the calls.
export const haptics: { calls: string[] } = { calls: [] };

jest.mock("expo-haptics", () => {
  const { haptics: h } = require("./setup");
  return {
    NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
    ImpactFeedbackStyle: { Light: "light" },
    notificationAsync: async (t: string) => { h.calls.push(t); },
    impactAsync: async (t: string) => { h.calls.push(`impact:${t}`); },
    selectionAsync: async () => { h.calls.push("selection"); },
  };
});
