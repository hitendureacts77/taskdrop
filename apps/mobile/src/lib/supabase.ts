import AsyncStorage from '@react-native-async-storage/async-storage';
import { LogBox } from 'react-native';
import { createBrowserClient } from '@taskdrop/supabase';

// Hermes has no WebCrypto, so supabase-js says (in development only) that the
// OAuth code challenge falls back to "plain". The flow still works; the notice
// just sat as a yellow bar over the bottom of every screen in Expo Go.
LogBox.ignoreLogs(['WebCrypto API is not supported']);

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// One typed client for the whole app, persisting the session in AsyncStorage.
export const supabase = createBrowserClient(url, anonKey, { storage: AsyncStorage });

/**
 * The signed-in user's id, from the stored session -- no network.
 *
 * `auth.getUser()` asks the auth server every time, and it was being called
 * before nearly every query: one extra round trip per request, on every
 * screen. Filters only need the id; the database still checks the token on
 * each request through row level security, so nothing is trusted that was not
 * already.
 */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * PostgREST filter for tasks still takeable: no deadline, or a deadline still
 * ahead. An open task whose deadline has passed stays on its poster's list,
 * but is no longer offered to workers with an Apply button.
 */
export function notExpired(): string {
  return `due_at.is.null,due_at.gt.${new Date().toISOString()}`;
}
