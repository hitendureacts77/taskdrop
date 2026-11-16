import test from 'node:test';
import assert from 'node:assert/strict';
import { bubbleRect, overlaps, planLabels, tagRect, youRect } from './mapLabels.ts';

test('rectangles overlap only when they share area', () => {
  assert.equal(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), true);
  assert.equal(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
});

test('pins far apart keep both names (P1-14)', () => {
  const plan = planLabels([
    { id: 'a', x: 100, y: 200, price: '₹4,750', tag: 'Narsingi · 10 jobs', rank: 4750 },
    { id: 'b', x: 400, y: 200, price: '₹900', tag: 'Madhapur · 5 jobs', rank: 900 },
  ]);
  assert.deepEqual(plan.get('a'), { dx: 0, showTag: true });
  assert.deepEqual(plan.get('b'), { dx: 0, showTag: true });
});

test('overlapping names: the bigger offer keeps its name, the other shows its price alone', () => {
  const plan = planLabels([
    { id: 'small', x: 120, y: 200, price: '₹900', tag: 'Botanical Garden +4 · 5 jobs', rank: 900 },
    { id: 'big', x: 160, y: 205, price: '₹4,750', tag: 'Narsingi +10 · 12 jobs', rank: 4750 },
  ]);
  assert.equal(plan.get('big')!.showTag, true);
  assert.equal(plan.get('small')!.showTag, false);
});

test('a name never covers another pin\'s price', () => {
  // b's bubble sits right where a's tag would go.
  const plan = planLabels([
    { id: 'a', x: 200, y: 200, price: '₹500', tag: 'Kondapur', rank: 9999 },
    { id: 'b', x: 200, y: 260, price: '₹400', tag: null, rank: 1 },
  ]);
  assert.ok(overlaps(tagRect(200, 200, 'Kondapur'), bubbleRect(200, 260, '₹400')));
  assert.equal(plan.get('a')!.showTag, false);
});

test('the You marker is never covered by a name', () => {
  const plan = planLabels([{ id: 'a', x: 200, y: 180, price: '₹500', tag: 'Gachibowli · 3 jobs', rank: 1 }], {
    avoid: [youRect(200, 210, false)],
  });
  assert.equal(plan.get('a')!.showTag, false);
});

test('a pin under the zoom buttons moves left, clear of them', () => {
  const controls = { x: 346, y: 8, w: 36, h: 120 };
  const plan = planLabels([{ id: 'edge', x: 360, y: 90, price: '₹4,750', tag: 'Narsingi', rank: 1 }], { controls });
  const dx = plan.get('edge')!.dx;
  assert.ok(dx < 0);
  assert.equal(overlaps(bubbleRect(360 + dx, 90, '₹4,750'), controls), false);
  // Away from the buttons nothing moves.
  assert.equal(planLabels([{ id: 'mid', x: 100, y: 90, price: '₹1', tag: null, rank: 1 }], { controls }).get('mid')!.dx, 0);
});
