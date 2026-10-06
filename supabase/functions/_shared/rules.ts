/**
 * The money and distance rules the server needs, copied from
 * packages/rules/src/index.ts.
 *
 * A copy, because an Edge Function is bundled from supabase/functions alone
 * and cannot import the workspace package. The api function's tests assert
 * that every value and formula here still equals the package's, so the two
 * cannot drift without a failing test.
 */

export const FEES = {
  WORKER_COMMISSION_PCT: 0.1,
  POSTER_SERVICE_FEE_PCT: 0.03,
  POST_START_CANCEL_PENALTY_PCT: 0.05,
} as const;

export function workerNetPayout(lockedMinor: number): number {
  return Math.round(lockedMinor * (1 - FEES.WORKER_COMMISSION_PCT));
}

export function distanceKm(
  a: { lat: number | null; lng: number | null },
  b: { lat: number | null; lng: number | null },
): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
