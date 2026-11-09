import test from 'node:test';
import assert from 'node:assert/strict';
import { clampReach, parseReachKm, parseSavedReach, peopleReach, postedToday, reachChoices, reachWords, withinReach, zoomToFit } from './mapReach.ts';

test('a wider reach never zooms in further', () => {
  const z5 = zoomToFit(5, 17.4, 700);
  const z10 = zoomToFit(10, 17.4, 700);
  const z25 = zoomToFit(25, 17.4, 700);
  assert.ok(z5 > z10 && z10 > z25, `${z5} ${z10} ${z25}`);
});

test('the zoom stays within the range the map allows', () => {
  for (const km of [0.05, 1, 5, 25, 20000]) {
    for (const lat of [0, 17.4, 60, 89]) {
      const z = zoomToFit(km, lat, 600);
      assert.ok(z >= 5 && z <= 17, `${km} km at ${lat}: ${z}`);
    }
  }
});

test('withinReach keeps only pinned items inside the radius', () => {
  const at = { lat: 17.4, lng: 78.4 };
  const list = [
    { id: 'near', loc_lat: 17.41, loc_lng: 78.41 },
    { id: 'far', loc_lat: 19.0, loc_lng: 79.0 },
    { id: 'nowhere', loc_lat: null, loc_lng: null },
  ];
  assert.deepEqual(withinReach(list, at, 5).map((x) => x.id), ['near']);
  assert.deepEqual(withinReach(list, at, 500).map((x) => x.id), ['near', 'far']);
  const people = [{ id: 'p', lat: 17.41, lng: 78.41 }];
  assert.equal(withinReach(people, at, 5, (p) => p).length, 1);
});

test('reach words say the radius and under 1 km', () => {
  const w = reachWords({ radius: 5, best: { id: 'a', rupees: 1200, km: 3.2 }, nearest: { id: 'b', rupees: 800, km: 0.4 } });
  assert.equal(w.bestLabel, 'Best offer within 5 km');
  assert.match(w.pitch, /under 1 km/);
  assert.match(w.pitch, /within 5 km is ₹1,200/);
  const same = reachWords({ radius: 10, best: { id: 'a', rupees: 1200, km: 0.4 }, nearest: { id: 'a', rupees: 1200, km: 0.4 } });
  assert.match(same.pitch, /₹1,200 job is under 1 km away, the best within 10 km/);
  assert.equal(reachWords({ radius: 5, best: null, nearest: null }).pitch, '');
});

test('parseReachKm accepts whole kilometres and clamps to 1-100', () => {
  assert.equal(parseReachKm('45'), 45);
  assert.equal(parseReachKm(' 50 km '), 50);
  assert.equal(parseReachKm('45.4'), 45);
  assert.equal(parseReachKm('250'), 100);
  assert.equal(parseReachKm('100'), 100);
  assert.equal(parseReachKm('1'), 1);
});

test('parseReachKm rejects empty, zero, negative and words', () => {
  for (const bad of ['', '   ', '0', '0.2', '-5', 'abc', '4 5', '1e3', 'km']) assert.equal(parseReachKm(bad), null, bad);
});

test('clampReach keeps a distance whole and in range', () => {
  assert.equal(clampReach(0), 1);
  assert.equal(clampReach(-3), 1);
  assert.equal(clampReach(12.6), 13);
  assert.equal(clampReach(1000), 100);
  assert.equal(clampReach(Number.NaN), 1);
});

test('parseSavedReach ignores junk', () => {
  assert.equal(parseSavedReach('45'), 45);
  assert.equal(parseSavedReach(null), null);
  assert.equal(parseSavedReach('nope'), null);
});

test('reachChoices lists the presets, the saved and the used distance once, in order', () => {
  assert.deepEqual(reachChoices(5, null), [{ km: 5, on: true }, { km: 10, on: false }, { km: 25, on: false }]);
  assert.deepEqual(reachChoices(45, 45).map((c) => c.km), [5, 10, 25, 45]);
  assert.deepEqual(reachChoices(10, 45).map((c) => `${c.km}${c.on ? '*' : ''}`), ['5', '10*', '25', '45']);
  assert.deepEqual(reachChoices(7, 45).map((c) => c.km), [5, 7, 10, 25, 45]);
  assert.equal(reachChoices(25, 10).filter((c) => c.km === 10).length, 1);
});

test('the people layer is capped at the server limit', () => {
  assert.equal(peopleReach(25), 25);
  assert.equal(peopleReach(80), 50);
});

test('postedToday counts the same calendar day', () => {
  const now = new Date(2026, 10, 8, 15, 0).getTime();
  const at = (d: number, h: number) => ({ created_at: new Date(2026, 10, d, h).toISOString() });
  assert.equal(postedToday([at(8, 1), at(8, 14), at(7, 23)], now), 2);
  assert.equal(postedToday([], now), 0);
});
