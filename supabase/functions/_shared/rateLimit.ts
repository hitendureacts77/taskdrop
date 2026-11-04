/**
 * One per-person speed limit for the server functions that are not `api` (task 2.13 part A).
 *
 * It uses the same counter `api` uses (public.api_rate_hit, service key only), under its own bucket
 * name, so a function can be limited without a new table. scripts/check-endpoints.mjs looks for
 * this file's name (or the counter's name) in every function that takes a signed-in caller.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.116.0";

/** The plain-words refusal every limited function sends. */
export const TOO_FAST = "You are going too fast. Please wait a moment and try again.";

/**
 * True when this person may go ahead. Counts one hit in the current minute.
 * A counter that cannot be reached lets the call through (an outage of the limiter must not become
 * an outage of payments), and says so to `onUnavailable`.
 */
export async function withinRate(
  admin: SupabaseClient,
  userId: string,
  bucket: string,
  limitPerMinute: number,
  onUnavailable?: (message: string) => void,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("api_rate_hit", { p_user: userId, p_bucket: bucket, p_limit: limitPerMinute });
    if (error) {
      onUnavailable?.(error.message);
      return true;
    }
    return data !== false;
  } catch (e) {
    onUnavailable?.(e instanceof Error ? e.message : String(e));
    return true;
  }
}
