/**
 * The maths behind the clock-face time picker (plan 1.21 B). No React in here,
 * so it is easy to test. A time is an hour on a 12-hour dial plus AM or PM,
 * and a minute in 5-minute steps; the saved value is still a plain Date.
 */

export const MINUTE_STEP = 5;
export const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

/** 12-hour dial reading to the 24-hour clock: 12 AM is 0, 12 PM is 12. */
export function to24(h12: number, pm: boolean): number {
  const h = ((Math.round(h12) % 12) + 12) % 12; // 12 and 0 both land on 0
  return h + (pm ? 12 : 0);
}

/** 24-hour clock to the dial: 0 is 12 AM, 13 is 1 PM. */
export function from24(h24: number): { h12: number; pm: boolean } {
  const h = ((Math.round(h24) % 24) + 24) % 24;
  return { h12: h % 12 === 0 ? 12 : h % 12, pm: h >= 12 };
}

/** Nearest 5-minute step; 58 rounds up to the next hour, so it returns 0 with carry 1. */
export function snapMinute(m: number): { minute: number; carry: number } {
  const snapped = Math.round(m / MINUTE_STEP) * MINUTE_STEP;
  return snapped >= 60 ? { minute: 0, carry: 1 } : { minute: Math.max(0, snapped), carry: 0 };
}

/** Round DOWN to a 5-minute step (used for an incoming time so it never moves later). */
export function floorMinute(m: number): number {
  return Math.min(55, Math.max(0, Math.floor(m / MINUTE_STEP) * MINUTE_STEP));
}

/** Angle of a point around the dial centre, in degrees clockwise from 12 o'clock (0..360). */
export function pointAngle(x: number, y: number, cx: number, cy: number): number {
  const deg = (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** The hour (1..12) nearest to a point on the dial. */
export function pointToHour(x: number, y: number, cx: number, cy: number): number {
  const h = Math.round(pointAngle(x, y, cx, cy) / 30) % 12;
  return h === 0 ? 12 : h;
}

/** The minute (0..55, 5-minute steps) nearest to a point on the dial. */
export function pointToMinute(x: number, y: number, cx: number, cy: number): number {
  return (Math.round(pointAngle(x, y, cx, cy) / (360 / MINUTES.length)) % MINUTES.length) * MINUTE_STEP;
}

/** Where a dial position sits: `index` of `count` around the circle at `radius`, from the centre. */
export function polar(index: number, count: number, radius: number, cx: number, cy: number): { x: number; y: number } {
  const a = (index / count) * 2 * Math.PI;
  return { x: cx + radius * Math.sin(a), y: cy - radius * Math.cos(a) };
}

export type TimeLimits = { min?: Date; max?: Date };

/** A day plus a time is allowed when it is after `min` (default: now) and not after `max`. */
export function isTimeAllowed(day: Date, h24: number, minute: number, limits: TimeLimits = {}, now: Date = new Date()): boolean {
  const at = new Date(day);
  at.setHours(h24, minute, 0, 0);
  const min = limits.min ?? now;
  if (at.getTime() <= min.getTime()) return false;
  if (limits.max && at.getTime() > limits.max.getTime()) return false;
  return true;
}

/** The first minute of an hour that is still allowed, or null when the whole hour is out. */
export function firstAllowedMinute(day: Date, h24: number, limits: TimeLimits = {}, now: Date = new Date(), from = 0): number | null {
  for (const m of MINUTES) {
    if (m >= from && isTimeAllowed(day, h24, m, limits, now)) return m;
  }
  return null;
}

/** The nearest allowed minute in the hour to `minute` (ties go later), or null. */
export function nearestAllowedMinute(day: Date, h24: number, minute: number, limits: TimeLimits = {}, now: Date = new Date()): number | null {
  const ok = MINUTES.filter((m) => isTimeAllowed(day, h24, m, limits, now));
  if (ok.length === 0) return null;
  return ok.reduce((best, m) => (Math.abs(m - minute) < Math.abs(best - minute) || (Math.abs(m - minute) === Math.abs(best - minute) && m > best) ? m : best));
}
