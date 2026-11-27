/**
 * Places this device remembers, and forgetting them at sign-out (B147).
 *
 * The last few places picked (recentPlaces.ts, with door details and four-decimal pins) and a guest's
 * chosen area (guestArea.ts), and the recent searches on each side. All go when anyone signs out, so the next person on this device, a guest included,
 * never sees the previous person's area or addresses. Pure (the storage is passed in) so it can be unit tested.
 */

export const RECENT_PLACES_KEY = 'taskdrop.recentPlaces.v1';
/** Same text as GUEST_AREA_KEY in guestArea.ts; placeMemory.test.ts fails if they drift apart. */
export const GUEST_AREA_STORAGE_KEY = 'taskdrop.guest.area.v1';

/** Recent searches on each side (recentSearches.ts, smart search): what someone searched is theirs too. */
export const RECENT_SEARCH_KEYS = ['taskdrop.recentSearches.earn.v1', 'taskdrop.recentSearches.hire.v1'] as const;

export const PLACE_KEYS: readonly string[] = [RECENT_PLACES_KEY, GUEST_AREA_STORAGE_KEY, ...RECENT_SEARCH_KEYS];

type Removable = { removeItem(key: string): Promise<void> };

/** Remove every remembered place. A key that cannot be removed does not stop the others. */
export async function forgetPlaces(storage: Removable): Promise<void> {
  await Promise.all(PLACE_KEYS.map((k) => storage.removeItem(k).catch(() => {})));
}
