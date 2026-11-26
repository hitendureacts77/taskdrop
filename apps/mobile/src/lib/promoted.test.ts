import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPromotedItems, liftPromoted, auctionIds } from './promoted.ts';

type Item = { id: string };
const row = (task_id: string, place: number | null = null, poster_id = 'p-' + task_id) => ({
  task_id, poster_id, top: place !== null, place,
});
const items: Item[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const key = (i: Item) => i.id;

test('no promoted rows: nothing on top, nothing badged, order untouched', () => {
  const r = pickPromotedItems({ items, live: [], keyOf: key });
  assert.deepEqual(r.top, []);
  assert.equal(r.badged.size, 0);
  assert.deepEqual(liftPromoted(items, r.top).map(key), ['a', 'b', 'c', 'd', 'e']);
});

test('the server decides: winners lift in place order, every live promoted item is badged', () => {
  const live = [row('a'), row('e', 2), row('c', 1)];
  const r = pickPromotedItems({ items, live, keyOf: key });
  assert.deepEqual(r.top.map(key), ['c', 'e']);
  assert.deepEqual([...r.badged].sort(), ['a', 'c', 'e']);
  assert.deepEqual(liftPromoted(items, r.top).map(key), ['c', 'e', 'a', 'b', 'd']);
});

test('never more than two on top even if the server sent more', () => {
  const live = [row('a', 1), row('b', 2), row('c', 3)];
  assert.deepEqual(pickPromotedItems({ items, live, keyOf: key }).top.map(key), ['a', 'b']);
});

test('a winner that is not in the list is ignored; the others still lift', () => {
  const live = [row('zzz', 1), row('d', 2)];
  const r = pickPromotedItems({ items, live, keyOf: key });
  assert.deepEqual(r.top.map(key), ['d']);
  assert.equal(r.badged.has('zzz'), false);
});

test('a promoted item that did not win keeps its place with the badge', () => {
  const r = pickPromotedItems({ items, live: [row('b')], keyOf: key });
  assert.deepEqual(r.top, []);
  assert.ok(r.badged.has('b'));
  assert.deepEqual(liftPromoted(items, r.top).map(key), ['a', 'b', 'c', 'd', 'e']);
});

test('helpers match on poster_id, report the service task id and prefer the winning service', () => {
  const helpers = [{ id: 'h1' }, { id: 'h2' }];
  const live = [row('svc-8', null, 'h2'), row('svc-9', 1, 'h2')];
  const r = pickPromotedItems({ items: helpers, live, keyOf: key, by: 'poster_id' });
  assert.deepEqual(r.top.map(key), ['h2']);
  assert.equal(r.taskIds.get('h2'), 'svc-9');
  assert.deepEqual(liftPromoted(helpers, r.top).map(key), ['h2', 'h1']);
});

test('auctionIds drops empties and duplicates, keeps order', () => {
  assert.deepEqual(auctionIds(['x', null, 'y', 'x', undefined, '']), ['x', 'y']);
});
