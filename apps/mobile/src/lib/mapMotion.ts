/**
 * The calm map motion from the approved design (plan D11), shared by the tile
 * map and the Google map so both move the same way:
 *
 * 1. Each area starts as a small dense dot (the "spot"), then spreads out into
 *    its soft circle: the area, never the exact spot. Closest to you first.
 * 2. Its tag pops in once the circle has nearly settled. Then nothing moves.
 * 3. Only items marked fresh (a task posted in the last few minutes) send out
 *    one slow ripple every few seconds, and never more than MAX_FRESH at once.
 *
 * Pure numbers only, so it runs in Node tests; the clock lives in useMapClock.
 */

/** How long the dot shows before it spreads. */
export const SPOT_MS = 300;
/** How long the dot takes to spread into the area. */
export const SPREAD_MS = 700;
/** Gap between one area and the next, nearest first. */
export const STAGGER_MS = 110;
/** Wait before the first area, so the map has drawn. */
export const START_MS = 250;
/** No intro runs longer than this, however many areas there are. */
export const MAX_INTRO_MS = 2600;
/** How long a tag takes to pop in. */
export const TAG_MS = 280;
/** A task this new ripples. */
export const FRESH_MS = 15 * 60_000;
/** At most this many areas ripple at once. */
export const MAX_FRESH = 2;
/** One ripple every this many ms ... */
export const RIPPLE_EVERY_MS = 3600;
/** ... lasting this long. */
export const RIPPLE_MS = 1600;
/** The dot's size against the full area. */
export const DOT_SCALE = 0.12;

export function easeOut(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return 1 - (1 - k) ** 3;
}

/**
 * When each area starts, in ms, nearest to `me` first (in screen pixels).
 * Without a centre the order is as given. The stagger shrinks for long lists
 * so the whole intro stays under MAX_INTRO_MS.
 */
export function introDelays(points: { x: number; y: number }[], me: { x: number; y: number } | null): number[] {
  const order = points.map((p, i) => ({ i, d: me ? Math.hypot(p.x - me.x, p.y - me.y) : i }));
  order.sort((a, b) => a.d - b.d);
  const room = MAX_INTRO_MS - START_MS - SPOT_MS - SPREAD_MS - TAG_MS;
  const step = points.length > 1 ? Math.min(STAGGER_MS, room / (points.length - 1)) : 0;
  const out = new Array<number>(points.length);
  order.forEach((o, rank) => (out[o.i] = Math.round(START_MS + rank * step)));
  return out;
}

/** When the intro for `count` areas is over and the clock can stop. */
export function introEnd(count: number): number {
  return Math.min(MAX_INTRO_MS, START_MS + Math.max(0, count - 1) * STAGGER_MS + SPOT_MS + SPREAD_MS + TAG_MS);
}

/**
 * An area at `elapsed` ms into the intro. `scale` is its size against the full
 * area; `dense` runs from 1 (the solid dot) to 0 (the settled soft circle).
 */
export function areaAt(elapsed: number, delay: number): { shown: boolean; scale: number; dense: number } {
  const t = elapsed - delay;
  if (t < 0) return { shown: false, scale: 0, dense: 1 };
  if (t < SPOT_MS) return { shown: true, scale: DOT_SCALE * easeOut(t / SPOT_MS), dense: 1 };
  const e = easeOut((t - SPOT_MS) / SPREAD_MS);
  return { shown: true, scale: DOT_SCALE + (1 - DOT_SCALE) * e, dense: 1 - e };
}

/** How far a tag has popped in, 0 (hidden) to 1 (settled). */
export function tagAt(elapsed: number, delay: number): number {
  const t = elapsed - (delay + SPOT_MS + SPREAD_MS * 0.6);
  return t <= 0 ? 0 : easeOut(t / TAG_MS);
}

/**
 * Where a fresh area's ripple is, 0 to 1, or null between ripples. `offset`
 * lets two ripples take turns instead of pulsing together.
 */
export function rippleAt(now: number, offset = 0): number | null {
  const phase = (((now + offset) % RIPPLE_EVERY_MS) + RIPPLE_EVERY_MS) % RIPPLE_EVERY_MS;
  return phase < RIPPLE_MS ? phase / RIPPLE_MS : null;
}

/** Posted recently enough to ripple. */
export function isFresh(createdAt: string | null | undefined, now: number): boolean {
  if (!createdAt) return false;
  const age = now - new Date(createdAt).getTime();
  return age >= 0 && age < FRESH_MS;
}

/** A group of several items gets a slightly bigger circle, so busy areas read as busy. */
export function groupScale(count: number): number {
  return count <= 1 ? 1 : Math.min(1.6, 1 + 0.12 * Math.sqrt(count - 1));
}

// Pin motion (plan 1.20, D33 step D): the timings each pin plays by itself.

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
