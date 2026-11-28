/**
 * Launch areas (migration 260, set on the admin's Web, Android & iOS page): where people can post
 * jobs. While they are on, a place outside every area can still be browsed, but posting a job there
 * is refused with the admin's "coming soon" message. The api refuses it too
 * (supabase/functions/_shared/controls.ts), so this only lets the app say so before sending.
 * Pure, so it is unit-tested.
 */

export type LaunchArea = { name: string; lat: number; lng: number; radiusKm: number };
export type LaunchAreas = { on: boolean; message: string | null; areas: LaunchArea[] };
export const LAUNCH_AREAS_OFF: LaunchAreas = { on: false, message: null, areas: [] };

/** What app-config sent, made safe. Anything odd means off: an outage of the switches must not close the whole country. */
export function normaliseLaunchAreas(raw: unknown): LaunchAreas {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return LAUNCH_AREAS_OFF;
  const r = raw as Record<string, unknown>;
  const areas = (Array.isArray(r.areas) ? r.areas : [])
    .map((a) => (a && typeof a === 'object' ? (a as Record<string, unknown>) : {}))
    .map((a) => ({ name: typeof a.name === 'string' ? a.name : '', lat: Number(a.lat), lng: Number(a.lng), radiusKm: Number(a.radiusKm) }))
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng) && Number.isFinite(a.radiusKm) && a.radiusKm > 0);
  const message = typeof r.message === 'string' && r.message.trim() ? r.message.trim() : null;
  return { on: r.on === true && areas.length > 0, message, areas };
}

export const OUTSIDE_AREA_FALLBACK = 'TaskDrop is not open for posting in this area yet. It is coming soon.';

/** Distance in km between two points (haversine). */
export function kmBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True while launch areas are off, and for an unknown place (remote jobs have none). */
export function insideLaunchAreas(la: LaunchAreas, lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (!la.on) return true;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  return la.areas.some((a) => kmBetween(lat, lng, a.lat, a.lng) <= a.radiusKm);
}

/** The sentence to show for a place outside every area, or null when the place is fine. */
export function outsideAreaMessage(la: LaunchAreas, lat: number | null | undefined, lng: number | null | undefined): string | null {
  return insideLaunchAreas(la, lat, lng) ? null : la.message ?? OUTSIDE_AREA_FALLBACK;
}

/** "Hyderabad and Bengaluru", for the browse note. */
export function areaNames(la: LaunchAreas): string {
  const names = la.areas.map((a) => a.name.trim()).filter(Boolean);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
