/**
 * One place for "where this person is" (P1-12 / P1-13). Hire Home, Earn Home and Explore each read the
 * profile on their own, at their own pace, and Earn Home used to say "Set your location" while Hire Home
 * already showed the area. The last area read or chosen is kept here for the session, so every screen
 * starts from it at once and none asks for a place the person already gave.
 */

export type KnownArea = { label: string; lat: number; lng: number };

type ProfileLike = { loc_label?: string | null; loc_lat?: number | null; loc_lng?: number | null } | null | undefined;

/** The area on a profile, or null when it has no pin (a label alone cannot centre a map). */
export function areaFromProfile(p: ProfileLike): KnownArea | null {
  if (!p || p.loc_lat == null || p.loc_lng == null) return null;
  return { label: p.loc_label ?? 'Your area', lat: p.loc_lat, lng: p.loc_lng };
}

/** The same point: keep the old object, so lists keyed on it are not read again. */
export function sameArea(a: KnownArea | null, b: KnownArea | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.lat === b.lat && a.lng === b.lng && a.label === b.label;
}

let cached: { owner: string; area: KnownArea | null } | null = null;

/**
 * What was last known for this person (a user id, or 'guest'): the area, null for "known to have none",
 * or undefined when nothing was read yet this session.
 */
export function peekArea(owner: string | null | undefined): KnownArea | null | undefined {
  if (!owner || !cached || cached.owner !== owner) return undefined;
  return cached.area;
}

export function rememberArea(owner: string | null | undefined, area: KnownArea | null): void {
  if (!owner) return;
  cached = { owner, area };
}

/** Signed out, or tests: forget it. */
export function forgetArea(): void {
  cached = null;
}
