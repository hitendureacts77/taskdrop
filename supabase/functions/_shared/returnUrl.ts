/**
 * Where Razorpay may send a payer after paying (task 2.13 part C, API Top 10 "unsafe consumption" / open redirect).
 *
 * The app asks for the payment link with the address to come back to. Taking that address as given would let a
 * caller (or a script) make Razorpay's own page redirect a payer to any website. The app only ever sends its own
 * website address, so anything else is dropped and the link is made without a return address.
 */
import { originAllowed } from "./cors.ts";

/** The return address if it is on one of TaskDrop's own websites (same list as CORS), otherwise null. */
export function safeReturnUrl(raw: unknown, allowedOrigins: string | undefined | null): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  return originAllowed(u.origin, allowedOrigins) ? u.toString() : null;
}
