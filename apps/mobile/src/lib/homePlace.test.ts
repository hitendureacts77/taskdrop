import test from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultPlace } from './homePlace.ts';

const home = (label: string, lat: number | null = 12.9, lng: number | null = 77.6) => ({ label, lat, lng, details: { tag: 'home' as const } });
const work = (label: string) => ({ label, lat: 12.8, lng: 77.5, details: { tag: 'work' as const } });
const profile = { loc_label: 'Indiranagar', loc_lat: 12.97, loc_lng: 77.64 };

test('a saved home beats the profile location', () => {
  const r = pickDefaultPlace([work('Office'), home('Flat 4')], profile);
  assert.deepEqual(r, { label: 'Flat 4', lat: 12.9, lng: 77.6, source: 'home' });
});

test('the most recent home wins', () => {
  const r = pickDefaultPlace([home('New flat', 13, 78), home('Old flat')], profile);
  assert.equal(r?.label, 'New flat');
  assert.equal(r?.source, 'home');
});

test('without a home the profile location is used', () => {
  const r = pickDefaultPlace([work('Office')], profile);
  assert.deepEqual(r, { label: 'Indiranagar', lat: 12.97, lng: 77.64, source: 'profile' });
});

test('entries without coordinates are ignored', () => {
  assert.equal(pickDefaultPlace([home('No pin', null, null)], profile)?.source, 'profile');
  assert.equal(pickDefaultPlace([home('Half pin', 12.9, null), home('Real')], null)?.label, 'Real');
  assert.equal(pickDefaultPlace([], { loc_label: 'X', loc_lat: null, loc_lng: null }), null);
  assert.equal(pickDefaultPlace([], { loc_label: 'X', loc_lat: 1, loc_lng: null }), null);
});

test('nothing saved gives null', () => {
  assert.equal(pickDefaultPlace([], null), null);
  assert.equal(pickDefaultPlace(undefined, undefined), null);
  assert.equal(pickDefaultPlace([work('Office')], {}), null);
});
