/**
 * Whether the inngest function may run with its signature check switched off (INNGEST_DEV=1), task 2.14, H50.
 *
 * Dev mode lets anyone who can reach the function run every job, so a stray INNGEST_DEV on the wrong project would
 * hand the jobs to the internet. It is allowed only on the staging project and on a developer's own machine. The
 * host is matched exactly (a look-alike such as wjxvingpfbfvkfqhrguj.supabase.co.evil.test does not pass), and a
 * missing or unreadable address counts as "not allowed".
 *
 * No Deno imports on purpose, so it can be exercised from Node.
 */

/** The staging project's address; production has its own and is never listed here. */
export const STAGING_HOST = "wjxvingpfbfvkfqhrguj.supabase.co";

export function devModeAllowed(supabaseUrl: string | undefined | null): boolean {
  let host: string;
  try {
    host = new URL(String(supabaseUrl ?? "")).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === STAGING_HOST || host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}
