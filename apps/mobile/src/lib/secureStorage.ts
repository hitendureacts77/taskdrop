import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Storage for the Supabase session (access + refresh token).
 *
 * On a phone the session goes into SecureStore, which keeps it encrypted under
 * a key held in the Android Keystore. AsyncStorage is plain text on disk, so a
 * rooted device or a backup would hand over a refresh token.
 *
 * SecureStore is not available on web, so web keeps AsyncStorage (localStorage).
 *
 * A session JSON can be larger than SecureStore likes to hold in one entry, so
 * values are split into chunks, with the chunk count kept under the key itself.
 */

const CHUNK = 1800;

const isNative = Platform.OS !== 'web';

// SecureStore keys may only contain letters, digits, ".", "-" and "_"; the
// Supabase key looks like "sb-<ref>-auth-token" but be safe anyway.
const safe = (key: string) => key.replace(/[^\w.-]/g, '_');
const part = (key: string, i: number) => `${safe(key)}.${i}`;

async function secureGet(key: string): Promise<string | null> {
  const count = await SecureStore.getItemAsync(safe(key));
  if (count === null) return null;
  const n = Number(count);
  if (!Number.isInteger(n) || n < 0) return null;
  let out = '';
  for (let i = 0; i < n; i++) {
    const piece = await SecureStore.getItemAsync(part(key, i));
    if (piece === null) return null; // torn write: treat as signed out
    out += piece;
  }
  return out;
}

async function secureRemove(key: string): Promise<void> {
  const count = await SecureStore.getItemAsync(safe(key));
  const n = Number(count);
  if (Number.isInteger(n)) {
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(part(key, i));
  }
  await SecureStore.deleteItemAsync(safe(key));
}

async function secureSet(key: string, value: string): Promise<void> {
  await secureRemove(key);
  const n = Math.ceil(value.length / CHUNK);
  for (let i = 0; i < n; i++) {
    await SecureStore.setItemAsync(part(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  await SecureStore.setItemAsync(safe(key), String(n));
}

export const sessionStorage = isNative
  ? {
      async getItem(key: string): Promise<string | null> {
        const secure = await secureGet(key);
        if (secure !== null) return secure;
        // One-time move for people already signed in with the old plain-text
        // store: copy into SecureStore, then wipe the plain-text copy.
        const legacy = await AsyncStorage.getItem(key);
        if (legacy !== null) {
          await secureSet(key, legacy);
          await AsyncStorage.removeItem(key);
        }
        return legacy;
      },
      setItem: secureSet,
      async removeItem(key: string): Promise<void> {
        await secureRemove(key);
        await AsyncStorage.removeItem(key);
      },
    }
  : AsyncStorage;
