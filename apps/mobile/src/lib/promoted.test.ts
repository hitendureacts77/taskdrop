import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPromotedItems, liftPromoted } from './promoted.ts';

type Item = { id: string; km: number | null; helper?: string };
const row = (task_id: string, top_today = 0, my_top_today = 0, poster_id = 'p-' + task_id, starts_at: string | null = null) => ({
  task_id, poster_id, top_today, my_top_today, starts_at,
});
const items: Item[] = [
  { id: 'a', km: 3 }, { id: 'b', km: 1 }, { id: 'c', km: null }, { id: 'd', km: 2 }, { id: 'e', km: 9 },
];
const key = (i: Item) => i.id;

test('no promoted rows: nothing on top, nothing badged, order untouched', () => {
  const r = pickPromotedItems({ items, live: [], keyOf: key });
  assert.deepEqual(r.top, []);
  assert.equal(r.badged.size, 0);
  assert.deepEqual(liftPromoted(items, r.top).map(key), ['a', 'b', 'c', 'd', 'e']);
});

test('at most two on top; the third promoted one keeps its place with the badge', () => {
  const live = [row('a'), row('c'), row('e')];
  const r = pickPromotedItems({ items, live, keyOf: key, kmOf: (i) => i.km });
  assert.deepEqual(r.top.map(key), ['a', 'e']);
  assert.deepEqual([...r.badged].sort(), ['a', 'c', 'e']);
  assert.deepEqual(liftPromoted(items, r.top).map(key), ['a', 'e', 'b', 'c', 'd']);
});

test('equal turns: fewest shown today first, tie to the nearer', () => {
  const live = [row('a', 5), row('b', 1), row('d', 1)];
  const r = pickPromotedItems({ items, live, keyOf: key, kmOf: (i) => i.km });
  assert.deepEqual(r.top.map(key), ['b', 'd']);
});

test('a promoted post the viewer filtered out is not on top but is still badged if listed', () => {
  const live = [row('a'), row('b')];
  const r = pickPromotedItems({ items, live, keyOf: key, matches: (i) => i.id !== 'a', kmOf: (i) => i.km });
  assert.deepEqual(r.top.map(key), ['b']);
  assert.ok(r.badged.has('a'));
});

test('a viewer who already saw a post on top three times today does not get it on top again', () => {
  const live = [row('a', 0, 3), row('b', 0, 0)];
  const r = pickPromotedItems({ items, live, keyOf: key, kmOf: (i) => i.km });
  assert.deepEqual(r.top.map(key), ['b']);
  assert.ok(r.badged.has('a'));
});

test('promoted posts that are not in the list are ignored', () => {
  const r = pickPromotedItems({ items, live: [row('zzz')], keyOf: key });
  assert.deepEqual(r.top, []);
  assert.equal(r.badged.size, 0);
});

test('helpers match on poster_id and report the service task id', () => {
  const helpers = [{ id: 'h1', km: 2 }, { id: 'h2', km: 1 }];
  const live = [row('svc-9', 0, 0, 'h2')];
  const r = pickPromotedItems({ items: helpers, live, keyOf: key, by: 'poster_id', kmOf: (i) => i.km });
  assert.deepEqual(r.top.map(key), ['h2']);
  assert.equal(r.taskIds.get('h2'), 'svc-9');
  assert.deepEqual(liftPromoted(helpers, r.top).map(key), ['h2', 'h1']);
});
