/**
 * Making Supabase Auth count a server-side sign-in against the person, not the server (task 2.8b).
 *
 * Auth limits sign-ins per network address. A sign-in this function makes on someone's behalf
 * comes from the function's own address, so without help every user would share one limit.
 * Auth trusts an `Sb-Forwarded-For` header naming the real address, but only when IP address
 * forwarding is on for the project and the request carries a secret key (`sb_secret_...`).
 * The publishable key and the legacy anon/service_role keys are ignored for this.
 */

/** The `default` key from SUPABASE_SECRET_KEYS (a JSON map Supabase gives every function); null when there is none. */
export function secretKey(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const keys = JSON.parse(raw) as Record<string, unknown>;
    const key = keys.default ?? Object.values(keys)[0];
    return typeof key === "string" && key.startsWith("sb_secret_") ? key : null;
  } catch {
    return null;
  }
}

/**
 * Which key to sign in with, and the header that names the person's address.
 * Without a secret key, or without a known address, this falls back to the anon key and no
 * header: exactly how sign-in worked before, so a project without a secret key still works.
 */
export function signInKey(
  ip: string | null,
  secret: string | null,
  anonKey: string,
): { key: string; headers: Record<string, string> } {
  if (!secret || !ip) return { key: anonKey, headers: {} };
  return { key: secret, headers: { "sb-forwarded-for": ip } };
}
