// node --experimental-strip-types --test apps/mobile/src/lib/placeMemory.test.ts
// B147: sign-out forgets the saved area and the recent places on this device.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GUEST_AREA_KEY } from './guestArea.ts';
import { GUEST_AREA_STORAGE_KEY, PLACE_KEYS, RECENT_PLACES_KEY, forgetPlaces } from './placeMemory.ts';

/** A storage like AsyncStorage / localStorage, held in a map. */
function fakeStorage(start: Record<string, string>, failOn?: string) {
  const items = new Map(Object.entries(start));
  return {
    items,
    removeItem: async (k: string) => {
      if (k === failOn) throw new Error('storage refused');
      items.delete(k);
    },
  };
}

test('B147 sign-out removes the recent places and the saved area, and nothing else', async () => {
  const s = fakeStorage({
    [RECENT_PLACES_KEY]: JSON.stringify([{ label: 'Flat 402, Sai Residency, Kondapur', lat: 17.4698, lng: 78.3576 }]),
    [GUEST_AREA_KEY]: JSON.stringify({ label: 'Kondapur', lat: 17.4698, lng: 78.3576 }),
    'taskdrop.theme': 'dark',
  });
  await forgetPlaces(s);
  assert.deepEqual([...s.items.keys()], ['taskdrop.theme']);
});

test('B147 one key that cannot be removed does not keep the other', async () => {
  const s = fakeStorage({ [RECENT_PLACES_KEY]: '[]', [GUEST_AREA_KEY]: '{}' }, RECENT_PLACES_KEY);
  await forgetPlaces(s);
  assert.equal(s.items.has(GUEST_AREA_KEY), false);
});

test('B147 the keys are the ones the stores write', () => {
  assert.equal(GUEST_AREA_STORAGE_KEY, GUEST_AREA_KEY);
  assert.deepEqual([...PLACE_KEYS].sort(), [GUEST_AREA_KEY, RECENT_PLACES_KEY].sort());
  const recent = readFileSync(new URL('./recentPlaces.ts', import.meta.url), 'utf8');
  assert.match(recent, /const KEY = RECENT_PLACES_KEY/);
});

test('B147 every sign-out (chosen or forced) runs the place clean-up', () => {
  const auth = readFileSync(new URL('../providers/AuthProvider.tsx', import.meta.url), 'utf8');
  const body = auth.slice(auth.indexOf('async function forgetGuestThingsOnDevice'), auth.indexOf('/** The person chose to sign out'));
  assert.match(body, /forgetPlacesOnDevice\(\)/);
});
