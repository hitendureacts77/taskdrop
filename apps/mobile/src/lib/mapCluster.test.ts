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

/** Every two groups at least `r` apart. */
function apart(g: { x: number; y: number }[], r: number) {
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) assert.ok(Math.hypot(g[i]!.x - g[j]!.x, g[i]!.y - g[j]!.y) >= r);
}

test('Kondapur: pins on near-identical points always share one group', () => {
  const pins = Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, x: 500 + (i % 3) * 0.4, y: 300 + (i % 2) * 0.3 }));
  const g = groupPins(pins, 40);
  assert.equal(g.length, 1);
  assert.equal(g[0]!.ids.length, 12);
});

test('two groups never end up closer than the radius, and no pin is lost', () => {
  // The first group's centre drifts towards the second as pins join it.
  const pins = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 70, y: 0 },
    { id: 'c', x: 35, y: 0 },
    { id: 'd', x: 50, y: 0 },
    { id: 'e', x: 65, y: 0 },
  ];
  const g = groupPins(pins, 40);
  apart(g, 40);
  assert.deepEqual(g.flatMap((x) => x.ids).sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('a pin joins the nearest group in reach, not the first', () => {
  const g = groupPins([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 70, y: 0 }, { id: 'c', x: 38, y: 0 }], 40);
  assert.deepEqual(g.map((x) => x.ids), [['a'], ['b', 'c']]);
});

test('a crowded town (200 pins): groups stay apart, every pin still there', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pins = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, x: rnd() * 400, y: rnd() * 400 }));
  const g = groupPins(pins, 40);
  apart(g, 40);
  assert.equal(g.reduce((n, x) => n + x.ids.length, 0), 200);
});
