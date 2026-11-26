import test from 'node:test';
import assert from 'node:assert/strict';
import { SPREAD_ZOOM, layoutPins, ringSpots, topAmount } from './mapLayout.ts';
import { groupPins } from './mapCluster.ts';
import { bubbleRect, helperPinRects, overlaps, taskPinRects } from './mapLabels.ts';

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

// D33 follow-up: two neighbouring spread areas used to lay their rings on top of each other (Mehdipatnam,
// Earn, zoom 14+: a "₹…" bubble sat on a "₹2,500" one). Boxes as the map draws them (MapPinLayer pinBox).
const TASK_GAP = { x: 150, y: 104 };
const HELPER_GAP = { x: 140, y: 98 };
const price = (id: string) => (id.length % 3 === 0 ? '₹12,500' : id.length % 3 === 1 ? '₹2,500' : '₹800');
const taskBox = (id: string, spread: boolean) => (spread ? taskPinRects(0, 0, price(id), 'Asha', 'Fix my tap', true).compact : bubbleRect(0, 0, price(id)));
const helperBox = (id: string) => helperPinRects(0, 0, 'AC repair', id.endsWith('x') ? null : '₹399').compact;

type Box = (id: string, spread: boolean) => { x: number; y: number; w: number; h: number };
function bubbles(items: ReturnType<typeof layoutPins>, box: Box) {
  return items.map((it) => {
    assert.equal(it.kind, 'one');
    const one = it as Extract<typeof it, { kind: 'one' }>;
    const b = box(one.id, one.area !== null);
    return { id: one.id, r: { x: one.x + b.x, y: one.y + b.y, w: b.w, h: b.h } };
  });
}
function overlapsOf(items: ReturnType<typeof layoutPins>, box: Box): string[] {
  const bs = bubbles(items, box);
  const out: string[] = [];
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (overlaps(bs[i]!.r, bs[j]!.r)) out.push(`${bs[i]!.id}/${bs[j]!.id}`);
  return out;
}
const idsOf = (items: ReturnType<typeof layoutPins>) => items.map((it) => (it.kind === 'one' ? it.id : it.ids.join(','))).sort();

test('two spread areas 50 px apart: no bubble sits on another, and no pin is lost', () => {
  const groups = [
    { x: 400, y: 300, ids: ['a1', 'a22', 'a333'] },
    { x: 450, y: 300, ids: ['b1', 'b22', 'b333', 'b4444'] },
  ];
  // Without the boxes' pass the two rings overlap (the bug).
  const rings = groups.flatMap((g) => ringSpots(g.ids.length, TASK_GAP).map((s, i) => ({ kind: 'one' as const, id: g.ids[i]!, x: g.x + s.dx, y: g.y + s.dy, area: { x: g.x, y: g.y, rx: 0, ry: 0 } })));
  assert.ok(overlapsOf(rings, taskBox).length > 0, 'the plain rings overlap');

  const items = layoutPins(groups, { zoom: SPREAD_ZOOM, gap: TASK_GAP, box: taskBox });
  assert.deepEqual(overlapsOf(items, taskBox), []);
  assert.deepEqual(idsOf(items), groups.flatMap((g) => g.ids).sort());
  // The order is kept and each area's first pin keeps its ring spot.
  assert.deepEqual(items.map((it) => (it.kind === 'one' ? it.id : '')), groups.flatMap((g) => g.ids));
  const first = items[0] as Extract<(typeof items)[number], { kind: 'one' }>;
  assert.equal(first.x, 400);
  assert.ok(first.y < 300);
});

test('an area on its own keeps its ring exactly', () => {
  const g = { x: 300, y: 300, ids: ['p1', 'p22', 'p333', 'p4444', 'p55555', 'p666666', 'p7777777'] };
  const items = layoutPins([g], { zoom: SPREAD_ZOOM, gap: TASK_GAP, box: taskBox });
  const spots = ringSpots(g.ids.length, TASK_GAP);
  items.forEach((it, i) => {
    assert.ok(it.kind === 'one');
    assert.ok(Math.abs(it.x - (g.x + spots[i]!.dx)) < 1e-9 && Math.abs(it.y - (g.y + spots[i]!.dy)) < 1e-9, `pin ${i} moved`);
  });
});

test('every area\'s soft circle still holds its own pins after they move', () => {
  const groups = [
    { x: 400, y: 300, ids: ['a1', 'a22', 'a333', 'a4444', 'a55555'] },
    { x: 440, y: 330, ids: ['b1', 'b22', 'b333', 'b4444', 'b55555', 'b666666'] },
  ];
  for (const it of layoutPins(groups, { zoom: SPREAD_ZOOM, gap: TASK_GAP, box: taskBox })) {
    assert.ok(it.kind === 'one' && it.area);
    assert.ok(Math.abs(it.x - it.area.x) < it.area.rx && Math.abs(it.y - it.area.y) < it.area.ry, it.id);
  }
});

// A busy part of town at zoom 14: rounded spots about 110 px apart (1 km), several tasks on most.
function crowd(n: number): { id: string; x: number; y: number }[] {
  const out: { id: string; x: number; y: number }[] = [];
  let seed = 7;
  const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) out.push({ id: 't' + 'x'.repeat(i % 5) + i, x: 300 + Math.floor(next() * 5) * 110, y: 300 + Math.floor(next() * 4) * 110 });
  return out;
}

test('a crowded town (60 tasks): no bubble on another, every pin still there', () => {
  const pins = crowd(60);
  const items = layoutPins(groupPins(pins, 80), { zoom: SPREAD_ZOOM, gap: TASK_GAP, box: taskBox });
  assert.deepEqual(overlapsOf(items, taskBox), []);
  assert.deepEqual(idsOf(items), pins.map((p) => p.id).sort());
});

test('helpers (people gaps, icon and price boxes): no overlap, every helper still there', () => {
  const pins = crowd(40);
  const items = layoutPins(groupPins(pins, 96), { zoom: SPREAD_ZOOM + 1, gap: HELPER_GAP, box: helperBox });
  assert.deepEqual(overlapsOf(items, helperBox), []);
  assert.deepEqual(idsOf(items), pins.map((p) => p.id).sort());
});

test('zoomed out nothing moves: stacks and price pins stay on their points', () => {
  const pins = crowd(30);
  const groups = groupPins(pins, 80);
  const items = layoutPins(groups, { zoom: SPREAD_ZOOM - 1, gap: TASK_GAP, box: taskBox });
  assert.deepEqual(items.map((it) => [it.x, it.y]), groups.map((g) => [g.x, g.y]));
});
