import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PickedPlace } from './location';

/**
 * The last few places someone picked.
 *
 * People post from the same handful of places — home, the office, a parent's
 * flat — so making them re-search every time is needless work. Held on the
 * device only: this is a convenience, not profile data, and it should not
 * follow anyone to another device or reach the server.
 */

const KEY = 'taskdrop.recentPlaces.v1';
const MAX = 5;

let cache: PickedPlace[] | null = null;

/** Synchronous read for render. Empty until load() has run once. */
export function recentPlaces(): PickedPlace[] {
  return cache ?? [];
}

export async function loadRecentPlaces(): Promise<PickedPlace[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as PickedPlace[]) : [];
    cache = Array.isArray(parsed) ? parsed.filter((p) => typeof p?.label === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function rememberPlace(place: PickedPlace): void {
  const label = place.label?.trim();
  if (!label) return;

  // Most recent first, no duplicates by label, and prefer the entry that
  // actually has coordinates if the same place comes back both ways. The typed
  // door details ride along, so picking a recent address fills the form back in
  // rather than making someone enter their own flat number twice.
  const existing = (cache ?? []).find((p) => p.label === label);
  const merged: PickedPlace = {
    label,
    lat: place.lat ?? existing?.lat ?? null,
    lng: place.lng ?? existing?.lng ?? null,
    area: place.area ?? existing?.area,
    details: place.details ?? existing?.details,
  };
  cache = [merged, ...(cache ?? []).filter((p) => p.label !== label)].slice(0, MAX);

  void AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {
    /* a lost convenience is not worth surfacing */
  });
}
