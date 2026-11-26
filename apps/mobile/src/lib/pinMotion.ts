import { MAX_FRESH, RIPPLE_EVERY_MS } from './mapMotion.ts';

/**
 * Numbers for the motion inside each map pin (plan 1.20 step D, design D33).
 * Pure, so Node tests can run them; the pins use them with RN Animated.
 */

/** The just-posted ripple grows from this radius to RING_R1 (px) while it fades. */
export const RING_R0 = 20;
export const RING_R1 = 50;
/** The ring view is drawn at its full size and scaled down to this at the start. */
export const RING_SCALE0 = RING_R0 / RING_R1;
/** Where the ring starts and ends in opacity. */
export const RING_OPACITY = 0.8;
/** Gap between one fresh pin's ripple and the next, so they take turns. */
export const RIPPLE_STAGGER_MS = 1200;
/** The active-now dot's soft pulse. */
export const PULSE_MS = 1600;
/** Extra room round a pin box so its ripple is never clipped by a native marker view. */
export const RIPPLE_ROOM = RING_R1;

/** When fresh pin number `rank` (0-based) starts its first ripple, in ms. */
export function rippleDelay(rank: number): number {
  return (Math.max(0, rank) * RIPPLE_STAGGER_MS) % RIPPLE_EVERY_MS;
}

/** The ring at progress p (0 to 1). */
export function ringAt(p: number): { scale: number; opacity: number } {
  const k = Math.min(1, Math.max(0, p));
  return { scale: RING_SCALE0 + (1 - RING_SCALE0) * k, opacity: RING_OPACITY * (1 - k) };
}

/** Which pins ripple: the first MAX_FRESH fresh ones, with their turn. */
export function rippleRanks(fresh: boolean[]): (number | null)[] {
  let n = 0;
  return fresh.map((f) => (f && n < MAX_FRESH ? n++ : null));
}

/** A motion epoch (an intro, a fold) is live until `until`; reduced motion makes it never live. */
export function epochLive(now: number, until: number, reduced: boolean): boolean {
  return !reduced && now < until;
}
