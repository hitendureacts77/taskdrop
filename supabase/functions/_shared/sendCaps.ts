/**
 * What to do with the answers of the two cost caps (migration 153, plan task 2.14, findings H39 and H40).
 * Pure functions, so they can be tested without a database or a network.
 */

export type SmsAnswer = { status: number; body: { error: string; capReached?: boolean } };

/**
 * The answer to give when take_sms_send did not say "ok", or null to go ahead and send.
 * Anything that is not exactly "ok" refuses: a broken or unexpected answer (including a counter that cannot be
 * reached) must never let a billed SMS through. The messages say nothing about whether a number has an account.
 */
export function smsRefusal(result: unknown): SmsAnswer | null {
  if (result === "ok") return null;
  if (result === "phone_cap") {
    return { status: 429, body: { error: "Too many codes were sent to this number today. Please try again tomorrow, or sign in with Google." } };
  }
  if (result === "day_cap") {
    return { status: 429, body: { error: "We cannot send more codes today. Please try again tomorrow, or sign in with Google.", capReached: true } };
  }
  return { status: 503, body: { error: "Could not send a code right now. Try again in a minute." } };
}

/**
 * Whether the number is known to have an account, from the door the person came through: signing in only gets this
 * far for a number with an account (phone-auth answers 404 otherwise), signing up only for one without (409
 * otherwise). null means the request named no door (an old app), so the caller has to look the number up.
 */
export function accountFromMode(mode: unknown): boolean | null {
  if (mode === "signin") return true;
  if (mode === "signup") return false;
  return null;
}

/**
 * The key the daily counter uses for a number: a keyed one-way hash (HMAC-SHA-256, 64 hex characters), so the
 * database never holds the number itself and the hash cannot be rebuilt by trying all ten-digit numbers without the
 * server key. The key is a server secret that never leaves the function; the label keeps this hash separate from any other use.
 */
export async function phoneCounterKey(phone: string, serverKey: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(serverKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode("sms-day:" + phone));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether a place search may call Google (billed) or must be answered from OpenStreetMap. Only "ok" may call Google. */
export function placesSource(result: unknown): "google" | "osm" {
  return result === "ok" ? "google" : "osm";
}
