import type { AddressDetails } from '@taskdrop/rules';
import type { GuestArea } from './guestArea';

/**
 * Where a new task should default to when the poster has not picked a place.
 *
 * First the address they saved as "Home" (the most recent one, recents are held
 * newest first), then the location on their profile, otherwise nothing. Entries
 * without coordinates are skipped: a default without a pin cannot show nearby
 * helpers. Pure and free of React Native so it can be unit tested.
 */

type PlaceLike = {
  label: string;
  lat: number | null;
  lng: number | null;
  area?: string;
  details?: AddressDetails;
};

type ProfileLike = {
  loc_label?: string | null;
  loc_lat?: number | null;
  loc_lng?: number | null;
} | null | undefined;

export type DefaultPlace = {
  label: string;
  lat: number;
  lng: number;
  /** Where it came from, so the screen can word it honestly. */
  source: 'home' | 'profile';
};

function hasCoords(lat: number | null | undefined, lng: number | null | undefined): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);
}

export function pickDefaultPlace(
  recents: readonly PlaceLike[] | null | undefined,
  profile: ProfileLike,
  guestArea?: GuestArea | null,
): DefaultPlace | null {
  for (const p of recents ?? []) {
    if (p?.details?.tag !== 'home' || !p.label || !hasCoords(p.lat, p.lng)) continue;
    return { label: p.label, lat: p.lat, lng: p.lng as number, source: 'home' };
  }
  // The pin dropped at sign-up saves coordinates only, with no name: still a usable default.
  if (hasCoords(profile?.loc_lat, profile?.loc_lng)) {
    return {
      label: profile?.loc_label?.trim() || 'Your saved location',
      lat: profile?.loc_lat as number,
      lng: profile?.loc_lng as number,
      source: 'profile',
    };
  }
  // A guest has no profile: the area they chose lives on the device (B87).
  if (guestArea && hasCoords(guestArea.lat, guestArea.lng)) {
    return { label: guestArea.label, lat: guestArea.lat, lng: guestArea.lng, source: 'profile' };
  }
  return null;
}

/** How far Home's "Services near you" reaches around the home place before remote listings (B35). */
export const HOME_FEED_RADIUS_KM = 25;

/** Most remote listings (no pin) shown after the nearby ones on Home. */
export const HOME_FEED_REMOTE_MAX = 10;

type Pinned = { id: string; loc_lat: number | null; loc_lng: number | null };

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const s = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

/**
 * Home's feed around the home place (B35): the listings near it, nearest first, then remote ones (no pin, so they
 * can be done from anywhere: tasks are local AND remote), in the order the server sent them (newest first). `near`
 * is a radius search around `at`; `wide` is a plain newest-first read, of which only the remote rows are kept.
 */
export function nearThenRemote<T extends Pinned>(near: readonly T[], wide: readonly T[], at: { lat: number; lng: number }): T[] {
  const pinned = near
    .filter((t) => t.loc_lat != null && t.loc_lng != null)
    .map((t) => ({ t, d: km(at, { lat: t.loc_lat as number, lng: t.loc_lng as number }) }))
    .sort((x, y) => x.d - y.d)
    .map((x) => x.t);
  const seen = new Set(pinned.map((t) => t.id));
  const remote = wide.filter((t) => (t.loc_lat == null || t.loc_lng == null) && !seen.has(t.id)).slice(0, HOME_FEED_REMOTE_MAX);
  return [...pinned, ...remote];
}
