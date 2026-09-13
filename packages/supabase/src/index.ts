import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@taskdrop/db-types';

export type TaskDropClient = SupabaseClient<Database>;

/**
 * Create a typed Supabase client for a browser/mobile session (uses the
 * publishable/anon key; all access is governed by RLS).
 *
 * `storage` lets the caller pass a platform-specific persistence layer
 * (AsyncStorage on React Native, the default web storage otherwise).
 */
export function createBrowserClient(
  url: string,
  anonKey: string,
  options?: { storage?: unknown },
): TaskDropClient {
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      ...(options?.storage ? { storage: options.storage as never } : {}),
    },
  });
}

/**
 * Create a service-role client for SERVER contexts only (Edge Functions,
 * Next.js route handlers). This bypasses RLS — never ship the service key to a
 * client bundle.
 */
export function createServiceClient(url: string, serviceRoleKey: string): TaskDropClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type { Database } from '@taskdrop/db-types';
export { Constants } from '@taskdrop/db-types';
