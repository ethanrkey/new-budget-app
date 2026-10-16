import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { splitChunks, chunkKey, manifestOf, parseManifest } from "./chunks";

// THE SESSION LIVES IN THE KEYCHAIN.
//
// Until build 11 the Supabase session sat in AsyncStorage, in plain
// text, behind a comment of ours that said moving it was "worth doing
// before this is on anyone else's phone" — and it is now. A session
// is not budget data: it is the credential that reaches the budget
// data on the server, and it refreshes itself, so one copy taken off
// a device keeps working. That is the thing worth protecting first.
//
// WHY CHUNKS AND NOT A CIPHER. expo-secure-store documents a
// 2048-byte limit per value and a Supabase session is bigger than
// that — an access-token JWT alone is about a kilobyte, plus the
// refresh token and the whole user object. Supabase's own docs answer
// this with "LargeSecureStore": AES-encrypt the session, put the
// ciphertext in AsyncStorage and only the key in the Keychain. That
// works, and it leaves the session on disk in a file whose protection
// is the app sandbox, protected by a key that is itself one Keychain
// read away. Splitting the value across several Keychain items keeps
// the SECRET ITSELF in the Keychain, and costs no cipher, no CSPRNG
// polyfill and no key rotation story. The arithmetic that makes the
// split safe is in lib/chunks.ts, where it can be tested in node.
//
// AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, and both halves are choices:
//
//   - AFTER_FIRST_UNLOCK rather than WHEN_UNLOCKED, because
//     `autoRefreshToken` can fire while the screen is off, and a
//     refresh that cannot read the session signs the user out for no
//     reason they can see.
//   - THIS_DEVICE_ONLY so the credential is never carried to a new
//     phone by an encrypted backup or iCloud Keychain. Restoring to a
//     new device means signing in again, which is the correct answer
//     for a credential and a thing to say out loud rather than
//     discover.
const ACCESSIBLE = SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY;
const opts = { keychainAccessible: ACCESSIBLE };

// Whether this platform HAS a Keychain, asked once. On iOS the answer
// is always yes; it is asked at all because jest and the web build
// run this module too, and a storage adapter that throws takes the
// whole app with it.
let availability: Promise<boolean> | null = null;
const secureAvailable = () => (availability ??= SecureStore.isAvailableAsync().catch(() => false));

/**
 * The Supabase auth storage adapter.
 *
 * THE MIGRATION IS IN `getItem`, DELIBERATELY. Every existing install
 * has its session in AsyncStorage under this exact key, and supabase-js
 * asks for it once on startup — so the first read after the update
 * finds nothing in the Keychain, falls back, moves what it finds, and
 * hands it over. Nobody is signed out, nothing has to run at launch,
 * and there is no migration flag to get wrong. The AsyncStorage copy
 * is deleted only AFTER the Keychain write has resolved: a crash in
 * between leaves two copies, which the next read collapses, and the
 * other order would lose the session.
 */
export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!(await secureAvailable())) return AsyncStorage.getItem(key);

    const count = parseManifest(await SecureStore.getItemAsync(key, opts));
    if (count != null) {
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await SecureStore.getItemAsync(chunkKey(key, i), opts);
        // A missing chunk means a torn write. Treat the whole value as
        // absent rather than hand supabase-js half a session, which it
        // would fail to parse in a way that reads as corruption.
        if (part == null) return null;
        parts.push(part);
      }
      return parts.join("");
    }

    // Nothing in the Keychain: either a fresh install, or one that
    // predates this. Move it across if it is the second.
    const legacy = await AsyncStorage.getItem(key);
    if (legacy == null) return null;
    await this.setItem(key, legacy);
    await AsyncStorage.removeItem(key);
    return legacy;
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!(await secureAvailable())) { await AsyncStorage.setItem(key, value); return; }

    // The OLD count first, so a value that shrank does not leave
    // orphan chunks behind for the next read to splice on.
    const before = parseManifest(await SecureStore.getItemAsync(key, opts)) ?? 0;
    const parts = splitChunks(value);
    for (let i = 0; i < parts.length; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), parts[i]!, opts);
    }
    // The manifest LAST. Until it is written the old value is still
    // the one a read sees, which is the right way round: a torn write
    // leaves the previous session rather than a spliced one.
    await SecureStore.setItemAsync(key, manifestOf(parts), opts);
    for (let i = parts.length; i < before; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i), opts);
    }
  },

  async removeItem(key: string): Promise<void> {
    // AsyncStorage too, always: an install that signs out before it
    // ever reads must not leave the old plaintext copy behind.
    await AsyncStorage.removeItem(key);
    if (!(await secureAvailable())) return;
    const count = parseManifest(await SecureStore.getItemAsync(key, opts)) ?? 0;
    await SecureStore.deleteItemAsync(key, opts);
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(chunkKey(key, i), opts);
  },
};
