import test from 'node:test';
import assert from 'node:assert/strict';
import { reachWords, withinReach, zoomToFit } from './mapReach.ts';

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
