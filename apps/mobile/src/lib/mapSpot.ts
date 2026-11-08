/**
 * "Show my spot to my people" (design D20): the pure rules, no React Native imports so they can be
 * unit-tested with plain node. The device reads its position, snaps it to a coarse grid here, and
 * only the snapped cell ever leaves the phone (lib/useMapSpot.ts). The server snaps again.
 */

/** Grid size in degrees: about 550 m north-south and 520 m east-west at Indian latitudes. */
export const SPOT_GRID = 0.005;
/** A shared spot goes stale this long after the last beat (the server expires it too). */
export const SPOT_TTL_MS = 15 * 60_000;
/** The spot is read and sent at most this often. */
export const BEAT_EVERY_MS = 120_000;
/** While the map is open, "My people" is refetched this often. */
export const PEOPLE_POLL_MS = 60_000;
/** Even in the same cell, send again after this long so the spot never expires while the app is open. */
export const BEAT_REFRESH_MS = 10 * 60_000;
/** Version of the consent wording the person agreed to; sent with setMapSharing. */
export const PEOPLE_MAP_NOTICE = 'v1';

export type Cell = { lat: number; lng: number };

/** Grid steps per degree, as an integer so the maths avoids float drift. */
const STEPS_PER_DEGREE = Math.round(1 / SPOT_GRID); // 200

function snapOne(v: number): number {
  // Whole grid steps first, then back to degrees: 3 decimals is exact for a 0.005 grid.
  const steps = Math.round(v * STEPS_PER_DEGREE);
  const out = Number((steps / STEPS_PER_DEGREE).toFixed(3));
  return out === 0 ? 0 : out; // never -0
}

/**
 * Snap a position to the nearest 0.005-degree grid point (a multiple of 0.005, 3 decimals).
 * Returns null for anything that is not a real position, so nothing odd is ever sent.
 * Exactly halfway between two grid points rounds towards +infinity (Math.round), the same way for
 * every cell, so a position can never flip-flop between cells on its own.
 */
export function snapCell(lat: number, lng: number): Cell | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: snapOne(lat), lng: snapOne(lng) };
}

export const sameCell = (a: Cell | null | undefined, b: Cell | null | undefined): boolean =>
  !!a && !!b && a.lat === b.lat && a.lng === b.lng;

/** What was last sent: the cell and when. */
export type LastBeat = { cell: Cell; at: number } | null;

/**
 * Should this cell be sent now?
 *  - nothing to send: no
 *  - never sent yet: yes
 *  - the clock went backwards: yes, rather than staying silent for hours
 *  - less than BEAT_EVERY_MS since the last send: no (also when the cell changed)
 *  - the cell changed: yes
 *  - same cell, but BEAT_REFRESH_MS passed: yes (keeps the spot alive)
 */
export function shouldBeat(prev: LastBeat, next: Cell | null, now: number): boolean {
  if (!next) return false;
  if (!prev) return true;
  const since = now - prev.at;
  if (since < 0) return true;
  if (since < BEAT_EVERY_MS) return false;
  if (!sameCell(prev.cell, next)) return true;
  return since >= BEAT_REFRESH_MS;
}

/** A little clock difference between phone and server is fine. */
const SKEW_MS = 2 * 60_000;

/** Is a spot stamped `spotAt` (ISO string, ms or Date) still fresh at `now`? */
export function isSpotFresh(spotAt: string | number | Date | null | undefined, now: number): boolean {
  if (spotAt === null || spotAt === undefined || spotAt === '') return false;
  const t = spotAt instanceof Date ? spotAt.getTime() : typeof spotAt === 'number' ? spotAt : Date.parse(spotAt);
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age >= -SKEW_MS && age < SPOT_TTL_MS;
}
