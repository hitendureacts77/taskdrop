import { LogBox } from 'react-native';
import { FunctionRegion } from '@supabase/supabase-js';
import { createBrowserClient } from '@taskdrop/supabase';
import { sessionStorage } from './secureStorage';

// Hermes has no WebCrypto, so supabase-js says (in development only) that the
// OAuth code challenge falls back to "plain". The flow still works; the notice
// just sat as a yellow bar over the bottom of every screen in Expo Go.
LogBox.ignoreLogs(['WebCrypto API is not supported']);

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// One typed client for the whole app, persisting the session in SecureStore on
// a phone (Keystore-encrypted) and AsyncStorage on web.
export const supabase = createBrowserClient(url, anonKey, { storage: sessionStorage });

/**
 * Where our server functions run: Mumbai, next to the database. Left to
 * itself Supabase runs a function near the caller, so someone abroad would
 * have every one of its database queries cross to Mumbai and back; pinned,
 * there is one trip and the queries stay local.
 */
export const FUNCTIONS_REGION = FunctionRegion.ApSouth1;

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
