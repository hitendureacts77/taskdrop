import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which app is this: platform, version, OS and install. The server uses it to
 * apply the admin panel's per-platform switches (app-config, the api function)
 * and to list devices; none of it identifies the person.
 */

export type AppPlatform = 'web' | 'android' | 'ios';

export const PLATFORM_HEADER = 'x-taskdrop-platform';
export const VERSION_HEADER = 'x-taskdrop-app-version';

export const appPlatform: AppPlatform | null =
  Platform.OS === 'web' || Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null;

/** The app's own version (app.json), e.g. "1.0.0". */
export const appVersion: string | null = Constants.expoConfig?.version ?? null;

/** Sent on every call to our own server functions. */
export function clientHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (appPlatform) h[PLATFORM_HEADER] = appPlatform;
  if (appVersion) h[VERSION_HEADER] = appVersion;
  return h;
}

/** "Android 15", "iOS 19.1", a browser's user agent -- for the device list, never for decisions. */
export function osVersion(): string | null {
  try {
    if (Platform.OS === 'web') {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      return ua ? ua.slice(0, 64) : null;
    }
    const name = Device.osName ?? Platform.OS;
    const version = Device.osVersion ?? String(Platform.Version);
    return `${name} ${version}`.slice(0, 64);
  } catch {
    return null;
  }
}

const INSTALL_KEY = 'td:install-id';
let installIdMemo: string | null = null;

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const piece = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `${piece()}-${piece()}-${piece()}`;
}

/** A random id made once per install (per browser on web), so one device is one row. Not tied to the person or the phone. */
export async function installId(): Promise<string> {
  if (installIdMemo) return installIdMemo;
  try {
    const stored = await AsyncStorage.getItem(INSTALL_KEY);
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return (installIdMemo = stored);
  } catch {
    /* storage unavailable: use one for this run */
  }
  const fresh = randomId();
  installIdMemo = fresh;
  try {
    await AsyncStorage.setItem(INSTALL_KEY, fresh);
  } catch {
    /* ignore */
  }
  return fresh;
}
