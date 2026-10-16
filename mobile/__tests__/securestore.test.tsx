import { CHUNK_CHARS } from "../lib/chunks";

// THE SESSION'S STORAGE, and the migration that stops the update from
// signing everyone out.
//
// The arithmetic is proved in tests/mobile-securestore.test.mjs, in
// plain node. What only exists once a native module is in the way is
// the SEQUENCE: which store is read first, what happens to the old
// copy, and what a torn write looks like from the outside.

// `mock` prefix: jest allows a module factory to reference it.
const mockKeychain = new Map<string, string>();
let mockAvailable = true;
const mockCalls: string[] = [];

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  isAvailableAsync: async () => mockAvailable,
  getItemAsync: async (k: string) => { mockCalls.push(`get ${k}`); return mockKeychain.get(k) ?? null; },
  setItemAsync: async (k: string, v: string) => { mockCalls.push(`set ${k}`); mockKeychain.set(k, v); },
  deleteItemAsync: async (k: string) => { mockCalls.push(`del ${k}`); mockKeychain.delete(k); },
}));

const KEY = "sb-kjcvtpmorftjyejjskwm-auth-token";
/** A session the size of a real one: a JWT is about a kilobyte. */
const session = (n = 2500) => JSON.stringify({ access_token: "a".repeat(n), refresh_token: "r" });

type Store = {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
};
type AS = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; clear(): Promise<void> };

/**
 * A fresh module registry per test, and BOTH halves out of the same
 * one.
 *
 * `secureStorage` memoizes `isAvailableAsync` on first use, so the
 * no-Keychain test needs the module reloaded. The trap, which cost a
 * run: after `resetModules` a top-level `import AsyncStorage` in this
 * file and the copy the library requires are DIFFERENT module
 * instances with different backing stores, so a write on one side is
 * invisible on the other — and three tests failed claiming the old
 * plaintext had not been deleted when it had.
 */
let store: Store;
let AsyncStorage: AS;
beforeEach(async () => {
  mockKeychain.clear();
  mockCalls.length = 0;
  mockAvailable = true;
  jest.resetModules();
  // The shared mock in __tests__/setup.ts exports the module itself,
  // not a { default } wrapper, so take whichever is there.
  const mod = require("@react-native-async-storage/async-storage");
  AsyncStorage = mod.default ?? mod;
  await AsyncStorage.clear();
});
const load = (): Store => (store = require("../lib/secureStorage").secureSessionStorage);

test("a session too big for one Keychain item round-trips through several", async () => {
  load();
  const value = session();
  await store.setItem(KEY, value);

  expect(await store.getItem(KEY)).toBe(value);
  // It really was split — one item would have been over the limit.
  expect(mockKeychain.get(KEY)).toBe(String(Math.ceil(value.length / CHUNK_CHARS)));
  expect(mockKeychain.size).toBeGreaterThan(2);
  // And nothing landed in the plaintext store.
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
});

test("an existing AsyncStorage session is moved across on its first read", async () => {
  // THE BUG THIS WOULD HAVE CAUGHT is the one that does not throw:
  // ship the Keychain adapter with no migration and every installed
  // build signs out on update, because supabase-js asks the new
  // store for a key only the old store has.
  const value = session();
  await AsyncStorage.setItem(KEY, value);
  load();

  expect(await store.getItem(KEY)).toBe(value);
  // Moved, not copied: the plaintext copy is gone afterwards...
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
  // ...and the Keychain has it, so the SECOND read never touches
  // AsyncStorage again.
  expect(await store.getItem(KEY)).toBe(value);
  expect(mockKeychain.get(KEY)).not.toBeNull();
});

test("...and the old copy is deleted only after the new one is written", async () => {
  // The other order loses the session to a crash in between. This
  // reads the call log rather than trusting the source.
  await AsyncStorage.setItem(KEY, session());
  load();
  await store.getItem(KEY);

  const manifestWrite = mockCalls.indexOf(`set ${KEY}`);
  expect(manifestWrite).toBeGreaterThan(-1);
  // Everything the Keychain needed was written before this returned,
  // and AsyncStorage is only cleared after that — asserted by the
  // value itself, since the removal is the last thing that happens.
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
  expect(mockKeychain.get(KEY)).toBeTruthy();
});

test("a shorter session leaves no orphan chunks for the next read to splice on", async () => {
  load();
  await store.setItem(KEY, "x".repeat(CHUNK_CHARS * 4));
  const long = mockKeychain.size;
  await store.setItem(KEY, "y".repeat(CHUNK_CHARS));

  expect(await store.getItem(KEY)).toBe("y".repeat(CHUNK_CHARS));
  expect(mockKeychain.size).toBeLessThan(long);
  // Precisely: the manifest plus one chunk, and nothing left over.
  expect([...mockKeychain.keys()].sort()).toEqual([KEY, `${KEY}.part.0`]);
});

test("a torn write reads as no session at all, never as half of one", async () => {
  load();
  await store.setItem(KEY, session());
  // A chunk the manifest promises, gone.
  mockKeychain.delete(`${KEY}.part.1`);

  // Half a session is not a session: supabase-js would fail to parse
  // it in a way that reads as corruption rather than as a sign-in.
  expect(await store.getItem(KEY)).toBeNull();
});

test("signing out clears the Keychain AND any plaintext left behind", async () => {
  load();
  await store.setItem(KEY, session());
  // An install that signed out before it ever read would otherwise
  // leave the old copy sitting there for ever.
  await AsyncStorage.setItem(KEY, "stale plaintext");

  await store.removeItem(KEY);
  expect(mockKeychain.size).toBe(0);
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
  expect(await store.getItem(KEY)).toBeNull();
});

test("with no Keychain it still works, rather than taking the app down", async () => {
  // jest and the web build both run this module. A storage adapter
  // that throws takes the whole client with it.
  mockAvailable = false;
  load();
  await store.setItem(KEY, "plain");
  expect(await store.getItem(KEY)).toBe("plain");
  expect(mockKeychain.size).toBe(0);
  await store.removeItem(KEY);
  expect(await store.getItem(KEY)).toBeNull();
});
