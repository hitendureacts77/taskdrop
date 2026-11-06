/**
 * Whether a sign-in came from the guest's own "Make your account" pop-up (hunt round 2, B31).
 *
 * A guest's drafts, saves and half-made post move into an account only when that guest makes the account or
 * signs in from the pop-up (the sign-in page opened with FROM_GUEST). On a shared phone, a family tablet or a
 * shop's phone, someone else signing in later from the ordinary sign-in page must not find the guest's text
 * ("come to flat 302, call 98...") in their Drafts; then the guest's things are dropped instead.
 *
 * The sign-in page marks the hand-off while it is open (in memory) and on the device (for Google on the web,
 * where the page reloads on the way back). The mark counts for a short while only.
 *
 * Pure and free of React Native so it can be unit tested (guestHandoff.test.ts).
 */

/** How long a hand-off mark kept on the device still counts: long enough for a Google round trip. */
export const HANDOFF_WINDOW_MS = 30 * 60_000;

/**
 * True when this sign-in is the guest's own: the pop-up's sign-in page is open right now (`live`), or it was
 * opened a short while ago (`markedAt`, the time kept on the device, as text). A mark from the future (a clock
 * change) counts only within a minute.
 */
export function handoffFresh(live: boolean, markedAt: string | null | undefined, now = Date.now()): boolean {
  if (live) return true;
  const at = Number(markedAt);
  if (!markedAt || !Number.isFinite(at) || at <= 0) return false;
  return now - at >= -60_000 && now - at < HANDOFF_WINDOW_MS;
}
