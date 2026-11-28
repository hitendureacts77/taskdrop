import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaNames, insideLaunchAreas, normaliseLaunchAreas, outsideAreaMessage, OUTSIDE_AREA_FALLBACK } from './launchAreas.ts';

const HYD = { name: 'Hyderabad', lat: 17.385, lng: 78.4867, radiusKm: 40 };
const BLR = { name: 'Bengaluru', lat: 12.9716, lng: 77.5946, radiusKm: 35 };

test('config: launch areas off unless on with a real area', () => {
  assert.equal(normaliseLaunchAreas(undefined).on, false);
  assert.equal(normaliseLaunchAreas({ on: true, areas: [] }).on, false);
  assert.equal(normaliseLaunchAreas({ on: true, areas: [{ name: 'x', lat: 'no', lng: 1, radiusKm: 3 }] }).on, false);
  assert.deepEqual(normaliseLaunchAreas({ on: true, message: ' Soon! ', areas: [HYD] }), { on: true, message: 'Soon!', areas: [HYD] });
});

test('inside, outside and unknown places', () => {
  const la = { on: true, message: null, areas: [HYD, BLR] };
  assert.equal(insideLaunchAreas(la, 17.44, 78.38), true);
  assert.equal(insideLaunchAreas(la, 12.93, 77.62), true);
  assert.equal(insideLaunchAreas(la, 13.08, 80.27), false); // Chennai
  assert.equal(insideLaunchAreas(la, null, null), true);
  assert.equal(insideLaunchAreas({ ...la, on: false }, 13.08, 80.27), true);
  assert.equal(outsideAreaMessage(la, 13.08, 80.27), OUTSIDE_AREA_FALLBACK);
  assert.equal(outsideAreaMessage({ ...la, message: 'Coming soon' }, 13.08, 80.27), 'Coming soon');
  assert.equal(outsideAreaMessage(la, 17.44, 78.38), null);
  assert.equal(areaNames(la), 'Hyderabad and Bengaluru');
  assert.equal(areaNames({ ...la, areas: [HYD] }), 'Hyderabad');
});
