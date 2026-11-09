import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshCache, refreshDistanceKm, refreshKey, shouldRefresh } from './mapRefresh.ts';

const here = { lat: 17.4, lng: 78.4 };
// About 0.009 degrees of latitude is 1 km.
const north = (km: number) => ({ lat: here.lat + km / 111.2, lng: here.lng });

test('the move threshold is a third of the reach, never under 1 km', () => {
  assert.equal(refreshDistanceKm(2), 1);
  assert.equal(refreshDistanceKm(5), 5 / 3);
  assert.equal(refreshDistanceKm(25), 25 / 3);
  assert.equal(refreshDistanceKm(100), 100 / 3);
});

test('a first look always asks', () => {
  assert.equal(shouldRefresh({ searchedAt: null, centre: here, radiusKm: 25 }), true);
});

test('a small move does not ask, a big one does', () => {
  assert.equal(shouldRefresh({ searchedAt: here, centre: north(1.0), radiusKm: 5 }), false);
  assert.equal(shouldRefresh({ searchedAt: here, centre: north(2), radiusKm: 5 }), true);
  assert.equal(shouldRefresh({ searchedAt: here, centre: north(7), radiusKm: 25 }), false);
  assert.equal(shouldRefresh({ searchedAt: here, centre: north(9), radiusKm: 25 }), true);
});

test('zooming out past the reach asks even without a move', () => {
  assert.equal(shouldRefresh({ searchedAt: here, centre: here, radiusKm: 25, zoomedOutPastReach: true }), true);
});

test('the key rounds the centre and includes the kind and reach', () => {
  assert.equal(refreshKey('jobs', { lat: 17.4012, lng: 78.4049 }, 25), refreshKey('jobs', { lat: 17.4044, lng: 78.4001 }, 25));
  assert.notEqual(refreshKey('jobs', here, 25), refreshKey('jobs', here, 10));
  assert.notEqual(refreshKey('jobs', here, 25), refreshKey('people', here, 25));
  assert.notEqual(refreshKey('jobs', here, 25), refreshKey('jobs', north(5), 25));
});

test('the cache keeps an answer for a few minutes, then forgets it', () => {
  const c = createRefreshCache<string[]>(1000);
  c.set('a', ['x'], 0);
  assert.deepEqual(c.get('a', 500), ['x']);
  assert.equal(c.get('a', 1500), undefined);
  assert.equal(c.size, 0);
});

test('the cache drops the oldest when it is full', () => {
  const c = createRefreshCache<number>(1000, 2);
  c.set('a', 1, 0);
  c.set('b', 2, 0);
  c.set('c', 3, 0);
  assert.equal(c.get('a', 1), undefined);
  assert.equal(c.get('b', 1), 2);
  assert.equal(c.get('c', 1), 3);
});
