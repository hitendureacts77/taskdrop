import test from 'node:test';
import assert from 'node:assert/strict';
import { markSeen, newOffers, newOffersLabel } from './seenOffers.ts';

test('first run: every current offer counts as seen, and the counts become the record', () => {
  const { fresh, seed } = newOffers(new Map([['a', 3], ['b', 0]]), null);
  assert.equal(fresh.size, 0);
  assert.deepEqual(seed, { a: 3, b: 0 });
});

test('offers above the last seen count are new; a task posted since has all of its offers new', () => {
  const { fresh, seed } = newOffers(new Map([['a', 5], ['b', 2], ['c', 2]]), { a: 3, b: 2 });
  assert.equal(seed, null);
  assert.equal(fresh.get('a'), 2);
  assert.equal(fresh.has('b'), false);
  assert.equal(fresh.get('c'), 2);
});

test('a withdrawn offer never shows a negative or "new" count', () => {
  const { fresh } = newOffers(new Map([['a', 1]]), { a: 3 });
  assert.equal(fresh.has('a'), false);
});

test('opening a task records its count and drops tasks no longer open', () => {
  assert.deepEqual(markSeen({ a: 1, gone: 4 }, 'a', 3, new Set(['a'])), { a: 3 });
  assert.deepEqual(markSeen(null, 'x', 2.7), { x: 2 });
});

test('label', () => {
  assert.equal(newOffersLabel(2), '2 new');
  assert.equal(newOffersLabel(0), null);
  assert.equal(newOffersLabel(undefined), null);
});
