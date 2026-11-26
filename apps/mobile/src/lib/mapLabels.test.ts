import test from 'node:test';
import assert from 'node:assert/strict';
import { bubbleRect, helperPinRects, overlaps, planLabels, planSpread, tagRect, taskPinRects, youRect } from './mapLabels.ts';

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

test('spread pins: a full tag that would overlap a better pin steps back to compact, nothing disappears (D33)', () => {
  const a = taskPinRects(200, 300, '₹4,750', 'Ravi K', 'Fix my leaking tap', true);
  const b = taskPinRects(320, 300, '₹900', 'Meera S', 'Assemble a wardrobe', true);
  assert.ok(overlaps(a.full, b.full));
  const out = planSpread([
    { id: 'low', ...b, rank: 1 },
    { id: 'top', ...a, rank: 9 },
  ]);
  assert.equal(out.has('top'), false);
  assert.equal(out.has('low'), true);
});

test('spread pins: the picked pin always keeps its full tag', () => {
  const a = taskPinRects(200, 300, '₹4,750', 'Ravi K', 'Fix my leaking tap', true);
  const b = taskPinRects(240, 300, '₹900', 'Meera S', 'Assemble a wardrobe', true);
  const out = planSpread([
    { id: 'picked', ...b, rank: 0, keep: true },
    { id: 'top', ...a, rank: 9 },
  ]);
  assert.equal(out.has('picked'), false);
  assert.equal(out.has('top'), true);
});

test('spread pins: far apart keep every tag; a tag never covers another pin\'s bubble', () => {
  const far = planSpread([
    { id: 'a', ...taskPinRects(100, 300, '₹500', 'A', 'x', true), rank: 2 },
    { id: 'b', ...taskPinRects(400, 300, '₹400', 'B', 'y', true), rank: 1 },
  ]);
  assert.equal(far.size, 0);
  // b's bubble sits inside a's tag area (below a).
  const a = taskPinRects(200, 300, '₹500', 'Ravi', 'Fix my leaking tap', true);
  const b = taskPinRects(200, 340, '₹400', null, null, false);
  assert.ok(overlaps(a.full, b.compact));
  assert.equal(planSpread([{ id: 'a', ...a, rank: 9 }, { id: 'b', ...b, rank: 1 }]).has('a'), true);
});

test('spread pins: a pin with no tag has nothing to step back; helpers drop the service text', () => {
  const none = taskPinRects(200, 300, '₹500', null, null, false);
  assert.equal(none.full, none.compact);
  const h1 = helperPinRects(200, 300, 'AC repair', '₹399');
  const h2 = helperPinRects(300, 300, 'Wedding photography', '₹4,999');
  assert.ok(overlaps(h1.full, h2.full));
  const out = planSpread([{ id: 'live', ...h1, rank: 2 }, { id: 'other', ...h2, rank: 1 }]);
  assert.deepEqual([...out], ['other']);
  assert.ok(h2.compact.w < h2.full.w);
});

test('a typed area\'s pill is wider than the live "You" pill', () => {
  assert.ok(youRect(200, 200, false, true).w > youRect(200, 200, true).w);
});
