import test from 'node:test';
import assert from 'node:assert/strict';
import { fillShare, fillText, mergePromotable } from './promotePick.ts';
import type { PromotablePost } from '../data/api.ts';

const post = (id: string, o: Partial<PromotablePost> = {}): PromotablePost => ({
  id, title: `Task ${id}`, benchmark_minor: 10000, status: 'OPEN', quotes: 0, category: null, kind: 'request',
  crew_id: null, filled: 0, wanted: 1, ...o,
});

test('a next page is added after the shown ones, in order', () => {
  const merged = mergePromotable([post('a'), post('b')], [post('c'), post('d')]);
  assert.deepEqual(merged.map((p) => p.id), ['a', 'b', 'c', 'd']);
});

test('a task already shown is not listed twice', () => {
  const merged = mergePromotable([post('a'), post('b')], [post('b'), post('c')]);
  assert.deepEqual(merged.map((p) => p.id), ['a', 'b', 'c']);
});

test('open slots of one crew show as one card, across pages too', () => {
  const first = mergePromotable([], [post('a', { crew_id: 'c1', wanted: 5, filled: 1 }), post('b', { crew_id: 'c1', wanted: 5, filled: 1 }), post('x')]);
  assert.deepEqual(first.map((p) => p.id), ['a', 'x']);
  const next = mergePromotable(first, [post('c', { crew_id: 'c1', wanted: 5, filled: 1 }), post('y')]);
  assert.deepEqual(next.map((p) => p.id), ['a', 'x', 'y']);
});

test('fill words and share', () => {
  assert.equal(fillText(post('a', { crew_id: 'c', wanted: 5, filled: 1 })), '1 of 5 workers');
  assert.equal(fillText(post('a')), 'No worker yet');
  assert.equal(fillText(post('a', { kind: 'service' })), 'Open for customers');
  assert.equal(fillShare({ filled: 1, wanted: 5 }), 0.2);
  assert.equal(fillShare({ filled: 9, wanted: 5 }), 1);
  assert.equal(fillShare({ filled: 0, wanted: 0 }), 0);
});
