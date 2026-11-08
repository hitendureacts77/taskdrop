import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEAT_EVERY_MS,
  BEAT_REFRESH_MS,
  PEOPLE_MAP_NOTICE,
  PEOPLE_POLL_MS,
  SPOT_GRID,
  SPOT_TTL_MS,
  isSpotFresh,
  sameCell,
  shouldBeat,
  snapCell,
} from './mapSpot.ts';

const isMultiple = (v: number) => Math.abs(v / SPOT_GRID - Math.round(v / SPOT_GRID)) < 1e-9;

test('constants match the plan', () => {
  assert.equal(SPOT_GRID, 0.005);
  assert.equal(SPOT_TTL_MS, 900_000);
  assert.equal(BEAT_EVERY_MS, 120_000);
  assert.equal(PEOPLE_POLL_MS, 60_000);
  assert.equal(BEAT_REFRESH_MS, 600_000);
  assert.equal(PEOPLE_MAP_NOTICE, 'v1');
});

test('snapCell rounds to the nearest 0.005 and keeps 3 decimals', () => {
  assert.deepEqual(snapCell(12.9716, 77.5946), { lat: 12.97, lng: 77.595 });
  assert.deepEqual(snapCell(19.076, 72.8777), { lat: 19.075, lng: 72.88 });
  assert.deepEqual(snapCell(28.6139, 77.209), { lat: 28.615, lng: 77.21 });
});

test('snapCell: values already on the grid do not move', () => {
  assert.deepEqual(snapCell(12.97, 77.595), { lat: 12.97, lng: 77.595 });
  assert.deepEqual(snapCell(0, 0), { lat: 0, lng: 0 });
});

test('snapCell: cell edges (just either side of the midpoint)', () => {
  // the midpoint between 12.970 and 12.975 is 12.9725
  assert.equal(snapCell(12.9724, 77)!.lat, 12.97);
  assert.equal(snapCell(12.9726, 77)!.lat, 12.975);
  // and between 77.495 and 77.500 it is 77.4975
  assert.equal(snapCell(10, 77.4974)!.lng, 77.495);
  assert.equal(snapCell(10, 77.4976)!.lng, 77.5);
});

test('snapCell: every point inside a cell snaps to the same centre', () => {
  const seen = new Set<number>();
  // 12.97255 .. 12.97745 sits entirely between the midpoints 12.9725 and 12.9775
  for (let i = 0; i <= 48; i++) seen.add(snapCell(12.97255 + 0.0001 * i, 77)!.lat);
  assert.deepEqual([...seen], [12.975]);
});

test('snapCell: negative numbers (south and west) snap the same distance', () => {
  assert.deepEqual(snapCell(-33.8688, -70.6693), { lat: -33.87, lng: -70.67 });
  assert.equal(snapCell(-12.9724, 0)!.lat, -12.97);
  assert.equal(snapCell(-12.9726, 0)!.lat, -12.975);
  const tiny = snapCell(-0.0024, -0.0024)!;
  assert.ok(Object.is(tiny.lat, 0), 'never -0');
  assert.ok(Object.is(tiny.lng, 0), 'never -0');
  assert.equal(snapCell(-0.0026, 0)!.lat, -0.005);
});

test('snapCell: the output is always a multiple of 0.005 with at most 3 decimals', () => {
  for (let i = 0; i < 500; i++) {
    const lat = Math.min(90, -90 + (i * 180) / 499 + 0.00137);
    const lng = Math.min(180, -180 + (i * 360) / 499 + 0.00291);
    const c = snapCell(lat, lng)!;
    assert.ok(isMultiple(c.lat), `lat ${c.lat}`);
    assert.ok(isMultiple(c.lng), `lng ${c.lng}`);
    assert.equal(c.lat, Number(c.lat.toFixed(3)));
    assert.equal(c.lng, Number(c.lng.toFixed(3)));
  }
});

test('snapCell: never more than half a cell away from the real position', () => {
  for (const [lat, lng] of [[12.9716, 77.5946], [-33.8688, 151.2093], [28.7041, 77.1025], [0.0013, -0.0013]]) {
    const c = snapCell(lat, lng)!;
    assert.ok(Math.abs(c.lat - lat) <= SPOT_GRID / 2 + 1e-9);
    assert.ok(Math.abs(c.lng - lng) <= SPOT_GRID / 2 + 1e-9);
  }
});

test('snapCell: poles and the date line are accepted, junk is refused', () => {
  assert.deepEqual(snapCell(90, 180), { lat: 90, lng: 180 });
  assert.deepEqual(snapCell(-90, -180), { lat: -90, lng: -180 });
  assert.equal(snapCell(NaN, 77), null);
  assert.equal(snapCell(12, Infinity), null);
  assert.equal(snapCell(90.5, 10), null);
  assert.equal(snapCell(10, 181), null);
});

test('sameCell compares both parts and tolerates null', () => {
  assert.ok(sameCell({ lat: 1, lng: 2 }, { lat: 1, lng: 2 }));
  assert.ok(!sameCell({ lat: 1, lng: 2 }, { lat: 1.005, lng: 2 }));
  assert.ok(!sameCell(null, { lat: 1, lng: 2 }));
  assert.ok(!sameCell(null, null));
});

const A = { lat: 12.97, lng: 77.595 };
const B = { lat: 12.975, lng: 77.595 };
const T0 = 1_000_000_000_000;

test('shouldBeat: first beat always goes; nothing to send never goes', () => {
  assert.equal(shouldBeat(null, A, T0), true);
  assert.equal(shouldBeat(null, null, T0), false);
  assert.equal(shouldBeat({ cell: A, at: T0 }, null, T0 + 999_999), false);
});

test('shouldBeat: never more often than every 2 minutes, even when the cell changed', () => {
  assert.equal(shouldBeat({ cell: A, at: T0 }, B, T0 + 1), false);
  assert.equal(shouldBeat({ cell: A, at: T0 }, B, T0 + BEAT_EVERY_MS - 1), false);
  assert.equal(shouldBeat({ cell: A, at: T0 }, A, T0 + BEAT_EVERY_MS - 1), false);
});

test('shouldBeat: a changed cell goes once 2 minutes have passed', () => {
  assert.equal(shouldBeat({ cell: A, at: T0 }, B, T0 + BEAT_EVERY_MS), true);
  assert.equal(shouldBeat({ cell: A, at: T0 }, B, T0 + 5 * 60_000), true);
});

test('shouldBeat: the same cell waits until 10 minutes have passed', () => {
  assert.equal(shouldBeat({ cell: A, at: T0 }, A, T0 + BEAT_EVERY_MS), false);
  assert.equal(shouldBeat({ cell: A, at: T0 }, A, T0 + BEAT_REFRESH_MS - 1), false);
  assert.equal(shouldBeat({ cell: A, at: T0 }, A, T0 + BEAT_REFRESH_MS), true);
});

test('shouldBeat: the refresh is shorter than the spot lifetime', () => {
  assert.ok(BEAT_REFRESH_MS < SPOT_TTL_MS);
});

test('shouldBeat: a clock that went backwards does not silence the spot', () => {
  assert.equal(shouldBeat({ cell: A, at: T0 }, A, T0 - 60_000), true);
});

test('isSpotFresh: inside and outside the 15 minute lifetime', () => {
  const now = T0;
  assert.equal(isSpotFresh(new Date(now - 1000).toISOString(), now), true);
  assert.equal(isSpotFresh(now - (SPOT_TTL_MS - 1), now), true);
  assert.equal(isSpotFresh(now - SPOT_TTL_MS, now), false);
  assert.equal(isSpotFresh(new Date(now - SPOT_TTL_MS - 1).toISOString(), now), false);
  assert.equal(isSpotFresh(new Date(now - 3_600_000), now), false);
});

test('isSpotFresh: small clock skew is fine, a far-future stamp is not', () => {
  assert.equal(isSpotFresh(T0 + 60_000, T0), true);
  assert.equal(isSpotFresh(T0 + 10 * 60_000, T0), false);
});

test('isSpotFresh: missing or garbage stamps are stale', () => {
  assert.equal(isSpotFresh(null, T0), false);
  assert.equal(isSpotFresh(undefined, T0), false);
  assert.equal(isSpotFresh('', T0), false);
  assert.equal(isSpotFresh('not a date', T0), false);
});
