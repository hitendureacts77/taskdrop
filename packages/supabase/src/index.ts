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
      // supabase-js defaults to 'implicit', which returns Google's session in
      // a URL fragment (#access_token=...) instead of a ?code= query param --
      // AuthProvider's OAuth callback handling only ever looks for the latter,
      // so an implicit-flow session lands in the URL and is silently dropped.
      // PKCE is what exchangeCodeForSession (used on both web and native) expects.
      flowType: 'pkce',
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
