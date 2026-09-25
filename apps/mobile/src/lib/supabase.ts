import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBrowserClient } from '@taskdrop/supabase';

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
