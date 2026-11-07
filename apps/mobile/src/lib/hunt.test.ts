import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCEPT_GRACE_MS, defaultNeeds, findAction, findDistanceText, huntCountsText, huntPhase, huntTimeLeft,
  missingParts, needsFor, pinLink, proofChecks, visibleFind,
} from './hunt.ts';
import { findWords, suggestOptions } from './posterOptions.ts';

const NOW = Date.parse('2026-11-07T10:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

test('find-type wording is spotted, with the words used', () => {
  assert.equal(findWords('Find Lantus insulin pens in stock near Kondapur'), 'Find');
  assert.equal(findWords('Lost my black cat near KPHB')?.toLowerCase(), 'lost');
  assert.equal(findWords('Where can I get a mirror for a 2016 Activa')?.toLowerCase(), 'where can i get');
  assert.equal(findWords('Looking for a size 9 Bata school shoe'), 'Looking for');
  assert.equal(findWords('Is Lantus in stock anywhere?'), 'in stock');
  assert.equal(findWords('Clean my kitchen on Saturday'), null);
  assert.equal(findWords('Fix a leaking tap'), null);
});

test('time left reads like the drawing, and ends', () => {
  assert.equal(huntTimeLeft(at(72 * 60_000), NOW), '1 h 12 m left');
  assert.equal(huntTimeLeft(at(2 * 3600_000), NOW), '2 h left');
  assert.equal(huntTimeLeft(at(45 * 60_000), NOW), '45 m left');
  assert.equal(huntTimeLeft(at(20_000), NOW), '1 m left');
  assert.equal(huntTimeLeft(at(3 * 86_400_000), NOW), '3 days left');
  assert.equal(huntTimeLeft(at(-1), NOW), 'Ended');
  assert.equal(huntTimeLeft(null, NOW), '');
});

test('a Hunt takes finds, then waits a day for the poster, then ends', () => {
  assert.equal(huntPhase({ hunt_until: null, status: 'OPEN' }, NOW), null);
  assert.equal(huntPhase({ hunt_until: at(60_000), status: 'OPEN' }, NOW), 'live');
  assert.equal(huntPhase({ hunt_until: at(-60_000), status: 'OPEN' }, NOW), 'reviewing');
  assert.equal(huntPhase({ hunt_until: at(-ACCEPT_GRACE_MS - 1), status: 'OPEN' }, NOW), 'ended');
  assert.equal(huntPhase({ hunt_until: at(60_000), status: 'COMPLETED' }, NOW), 'ended');
});

test('counts read as one sentence', () => {
  assert.equal(huntCountsText(7, 3), '7 people looking · 3 finds sent');
  assert.equal(huntCountsText(1, 1), '1 person looking · 1 find sent');
});

test('default parts: photo, name and pin at a place; no pin online', () => {
  assert.deepEqual(defaultNeeds(false), ['photo', 'place', 'pin']);
  assert.deepEqual(defaultNeeds(true), ['photo', 'place']);
  assert.deepEqual(needsFor(['pin', 'price'], true), ['price']);
  assert.deepEqual(needsFor(['pin'], true), ['photo', 'place']);
});

const flags = { has_photo: true, has_place: false, has_pin: true, has_price: false };

test('a missing part is named, and the button asks for it once', () => {
  assert.deepEqual(missingParts(flags, ['photo', 'place', 'pin']), ['place']);
  assert.deepEqual(
    proofChecks(flags, ['photo', 'place', 'pin']),
    [
      { label: 'Photo taken now', ok: true },
      { label: 'Shop name missing', ok: false },
      { label: 'Pin on map', ok: true },
    ],
  );
  assert.deepEqual(findAction({ ...flags, asked_part: null }, ['photo', 'place'], '₹300'), {
    kind: 'ask', part: 'place', label: 'Ask for the shop name',
  });
  assert.deepEqual(findAction({ ...flags, asked_part: 'place' }, ['photo', 'place'], '₹300'), {
    kind: 'accept', label: 'This is it · pay ₹300',
  });
  assert.equal(findAction({ ...flags, asked_part: null }, ['photo', 'pin'], '₹300').kind, 'accept');
});

test('distance is rounded to 0.1 km and missing when unknown', () => {
  assert.equal(findDistanceText(0.84), '0.8 km away');
  assert.equal(findDistanceText(0.04), '< 0.1 km away');
  assert.equal(findDistanceText(null), null);
});

test('a locked find never shows its photo, place, pin, price or note', () => {
  const row = { id: 'x', unlocked: false, photo_path: 'media:1', place_name: 'Apollo', lat: 1, lng: 2, price_note: '₹120', note: 'hi' };
  const v = visibleFind(row);
  assert.equal(v.photo_path, null);
  assert.equal(v.place_name, null);
  assert.equal(v.lat, null);
  assert.equal(v.price_note, null);
  assert.equal(v.note, null);
  assert.equal(visibleFind({ ...row, unlocked: true }).place_name, 'Apollo');
});

test('a pin opens in maps', () => {
  assert.equal(pinLink(17.4483, 78.3915), 'https://www.google.com/maps/search/?api=1&query=17.448300,78.391500');
});

test('find wording suggests a Hunt, with the reason, and switches nothing on', () => {
  const s = suggestOptions({ text: 'Find Lantus insulin pens in stock near Kondapur', whenNow: true, remote: false });
  assert.deepEqual(s.map((x) => x.key), ['hunt']);
  assert.match(s[0]!.reason, /Find/);
  assert.deepEqual(suggestOptions({ text: 'Fix a leaking tap', whenNow: false, remote: false }), []);
});
