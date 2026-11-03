import test from 'node:test';
import assert from 'node:assert/strict';
import { SPREAD_ZOOM, layoutPins, ringSpots, topAmount } from './mapLayout.ts';
import { groupPins } from './mapCluster.ts';

const gap = { x: 100, y: 80 };
const across = (a: { dx: number; dy: number }, b: { dx: number; dy: number }) => Math.hypot(a.dx - b.dx, (a.dy - b.dy) * (gap.x / gap.y));

test('one thing sits on the centre; two sit side by side', () => {
  assert.deepEqual(ringSpots(1, gap), [{ dx: 0, dy: 0 }]);
  const two = ringSpots(2, gap);
  assert.equal(two.length, 2);
  assert.ok(Math.abs(two[0]!.dy) < 1e-9 && Math.abs(two[1]!.dy) < 1e-9);
  assert.ok(Math.abs(two[0]!.dx - two[1]!.dx) >= gap.x - 1e-9);
});

test('every spot is distinct and at least one gap from the others', () => {
  for (const n of [3, 4, 6, 7, 10, 19, 25]) {
    const s = ringSpots(n, gap);
    assert.equal(s.length, n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(across(s[i]!, s[j]!) >= gap.x * 0.99, `n=${n} ${i},${j}`);
  }
});

test('three or more start at the top', () => {
  const s = ringSpots(4, gap);
  assert.ok(Math.abs(s[0]!.dx) < 1e-9 && s[0]!.dy < 0);
});

const sameSpot = [
  { id: 'a', x: 200, y: 200 },
  { id: 'b', x: 200, y: 200 },
  { id: 'c', x: 201, y: 199 },
  { id: 'far', x: 600, y: 600 },
];

test('zoomed out, things in one area make one group; far ones stay alone', () => {
  const items = layoutPins(groupPins(sameSpot, 60), { zoom: SPREAD_ZOOM - 2, gap });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { kind: 'group', ids: ['a', 'b', 'c'], x: (200 + 200 + 201) / 3, y: (200 + 200 + 199) / 3 });
  assert.equal(items[1]!.kind, 'one');
});

test('zoomed in, a group spreads out round its centre, in the same order, with its area', () => {
  const items = layoutPins(groupPins(sameSpot, 60), { zoom: SPREAD_ZOOM, gap });
  assert.equal(items.length, 4);
  const ones = items.filter((i) => i.kind === 'one');
  assert.deepEqual(ones.map((i) => i.id), ['a', 'b', 'c', 'far']);
  const first = ones[0]!;
  assert.ok(first.area);
  assert.ok(first.y < first.area.y, 'the first sits at the top');
  assert.ok(first.area.rx > gap.x && first.area.ry > gap.y * 0.5);
  assert.equal(ones[3]!.area, null);
});

test('an area shows its biggest offer', () => {
  const amounts: Record<string, number> = { a: 500, b: 2000, c: 1200 };
  assert.equal(topAmount(['a', 'b', 'c'], (id) => amounts[id]), 2000);
  assert.equal(topAmount(['x'], () => undefined), null);
});
