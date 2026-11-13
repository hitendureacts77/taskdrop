import assert from 'node:assert/strict';
import test from 'node:test';
import { guestAreaFromPicked, parseGuestArea, serializeGuestArea } from './guestArea.ts';

test('an area survives being saved and read back', () => {
  const a = { label: 'Gachibowli', lat: 17.44, lng: 78.35 };
  assert.deepEqual(parseGuestArea(serializeGuestArea(a)), a);
});

test('nothing saved, or damaged text, reads as no area', () => {
  assert.equal(parseGuestArea(null), null);
  assert.equal(parseGuestArea(''), null);
  assert.equal(parseGuestArea('not json'), null);
  assert.equal(parseGuestArea('{"label":"x","lat":"1","lng":2}'), null);
  assert.equal(parseGuestArea('{"label":"x","lat":95,"lng":2}'), null);
});

test('a missing label falls back to "Your area"', () => {
  assert.equal(parseGuestArea('{"lat":1,"lng":2}')?.label, 'Your area');
});

test('B87: a picked place becomes the saved guest area, a label-only one does not', () => {
  assert.deepEqual(guestAreaFromPicked({ label: 'Plot 4, Madhapur', area: 'Madhapur', lat: 17.45, lng: 78.39 }), {
    label: 'Madhapur',
    lat: 17.45,
    lng: 78.39,
  });
  assert.deepEqual(guestAreaFromPicked({ label: 'Madhapur', lat: 17.45, lng: 78.39 }), { label: 'Madhapur', lat: 17.45, lng: 78.39 });
  assert.equal(guestAreaFromPicked({ label: 'Madhapur', lat: null, lng: null }), null);
});
