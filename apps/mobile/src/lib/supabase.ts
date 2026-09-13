import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBrowserClient } from '@taskdrop/supabase';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// One typed client for the whole app, persisting the session in AsyncStorage.
export const supabase = createBrowserClient(url, anonKey, { storage: AsyncStorage });
