/** A guest's chosen area, kept on the device (no account, so no profile to hold it). Pure: storage lives in useMyArea. */
// Same rule as place.ts tidyLabel (B176), copied: this file is loaded by Node tests, which cannot import a sibling without its extension.
const tidyLabel = (label: string) =>
  label.split(',').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join(', ');

export type GuestArea = { label: string; lat: number; lng: number };

export const GUEST_AREA_KEY = 'taskdrop.guest.area.v1';

/** The saved text back into an area, or null when it is missing or damaged. */
export function parseGuestArea(raw: string | null | undefined): GuestArea | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GuestArea> | null;
    if (!v || typeof v.lat !== 'number' || typeof v.lng !== 'number') return null;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng) || Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) return null;
    // Saved before B176 with doubled spaces: tidied on the way back.
    return { label: typeof v.label === 'string' && tidyLabel(v.label) ? tidyLabel(v.label) : 'Your area', lat: v.lat, lng: v.lng };
  } catch {
    return null;
  }
}

export const serializeGuestArea = (a: GuestArea): string => JSON.stringify({ label: a.label, lat: a.lat, lng: a.lng });

/** The part of a picked place that matters here (structural, so this file stays free of React Native). */
type PickedLike = { label: string; area?: string; lat: number | null; lng: number | null };

/** What to save for a guest after they pick a place: the area name and its pin, or null when there is no pin. */
export function guestAreaFromPicked(picked: PickedLike): GuestArea | null {
  if (picked.lat === null || picked.lng === null) return null;
  return { label: tidyLabel(picked.area || picked.label), lat: picked.lat, lng: picked.lng };
}
