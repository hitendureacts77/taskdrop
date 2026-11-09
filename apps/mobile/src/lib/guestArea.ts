/** A guest's chosen area, kept on the device (no account, so no profile to hold it). Pure: storage lives in useMyArea. */
export type GuestArea = { label: string; lat: number; lng: number };

export const GUEST_AREA_KEY = 'taskdrop.guest.area.v1';

/** The saved text back into an area, or null when it is missing or damaged. */
export function parseGuestArea(raw: string | null | undefined): GuestArea | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GuestArea> | null;
    if (!v || typeof v.lat !== 'number' || typeof v.lng !== 'number') return null;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng) || Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) return null;
    return { label: typeof v.label === 'string' && v.label ? v.label : 'Your area', lat: v.lat, lng: v.lng };
  } catch {
    return null;
  }
}

export const serializeGuestArea = (a: GuestArea): string => JSON.stringify({ label: a.label, lat: a.lat, lng: a.lng });
