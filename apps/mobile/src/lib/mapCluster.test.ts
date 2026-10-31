import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPins, metresPerPixel } from './mapCluster.ts';

test('pins that are close are joined into one group; far ones stay alone', () => {
  const g = groupPins(
    [
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 110, y: 104 },
      { id: 'c', x: 300, y: 200 },
    ],
    40,
  );
  assert.equal(g.length, 2);
  assert.deepEqual(g[0]!.ids, ['a', 'b']);
  assert.equal(g[0]!.x, 105);
  assert.deepEqual(g[1]!.ids, ['c']);
});

test('no pins, no groups; pins exactly at the radius are not joined', () => {
  assert.deepEqual(groupPins([], 40), []);
  assert.equal(groupPins([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }], 40).length, 2);
});

test('the map scale halves with every zoom step and shrinks away from the equator', () => {
  assert.ok(Math.abs(metresPerPixel(0, 10) / metresPerPixel(0, 11) - 2) < 1e-9);
  assert.ok(metresPerPixel(60, 12) < metresPerPixel(0, 12));
  assert.ok(Math.abs(metresPerPixel(13, 12) - 37.2) < 0.5);
});
