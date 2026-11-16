import test from 'node:test';
import assert from 'node:assert/strict';
import { areaFromProfile, forgetArea, peekArea, rememberArea, sameArea } from './areaCache.ts';

test('a profile gives an area only with a pin', () => {
  assert.equal(areaFromProfile(null), null);
  assert.equal(areaFromProfile({ loc_label: 'Madhapur', loc_lat: null, loc_lng: 78.3 }), null);
  assert.deepEqual(areaFromProfile({ loc_label: 'Madhapur', loc_lat: 17.4, loc_lng: 78.3 }), { label: 'Madhapur', lat: 17.4, lng: 78.3 });
  assert.deepEqual(areaFromProfile({ loc_lat: 17.4, loc_lng: 78.3 }), { label: 'Your area', lat: 17.4, lng: 78.3 });
});

test('the remembered area belongs to one person (P1-13)', () => {
  forgetArea();
  assert.equal(peekArea('u1'), undefined);
  const a = { label: 'Madhapur', lat: 17.4, lng: 78.3 };
  rememberArea('u1', a);
  assert.equal(peekArea('u1'), a);
  assert.equal(peekArea('u2'), undefined);
  assert.equal(peekArea(null), undefined);
  rememberArea('u1', null);
  assert.equal(peekArea('u1'), null);
  forgetArea();
  assert.equal(peekArea('u1'), undefined);
});

test('same area compares the point and the name', () => {
  const a = { label: 'A', lat: 1, lng: 2 };
  assert.equal(sameArea(a, { ...a }), true);
  assert.equal(sameArea(a, { ...a, lat: 1.1 }), false);
  assert.equal(sameArea(a, null), false);
  assert.equal(sameArea(null, null), true);
});
