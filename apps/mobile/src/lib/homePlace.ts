import type { AddressDetails } from '@taskdrop/rules';

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

export function pickDefaultPlace(recents: readonly PlaceLike[] | null | undefined, profile: ProfileLike): DefaultPlace | null {
  for (const p of recents ?? []) {
    if (p?.details?.tag !== 'home' || !p.label || !hasCoords(p.lat, p.lng)) continue;
    return { label: p.label, lat: p.lat, lng: p.lng as number, source: 'home' };
  }
  if (profile?.loc_label && hasCoords(profile.loc_lat, profile.loc_lng)) {
    return { label: profile.loc_label, lat: profile.loc_lat, lng: profile.loc_lng as number, source: 'profile' };
  }
  return null;
}
