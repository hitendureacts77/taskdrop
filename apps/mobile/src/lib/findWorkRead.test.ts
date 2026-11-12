import test from 'node:test';
import assert from 'node:assert/strict';
import { FIND_WORK_LIMIT, findWorkSearches, joinFindWork } from './findWorkRead.ts';

const job = (id: string, lat: number | null = 12.9, lng: number | null = 77.6) => ({ id, loc_lat: lat, loc_lng: lng });

test('with a place the nearby read carries the radius, the wide read does not', () => {
  const { near, wide } = findWorkSearches({ lat: 12.97, lng: 77.59 }, 25, 'paint');
  assert.deepEqual(near, { q: 'paint', limit: FIND_WORK_LIMIT, kind: 'request', near: { lat: 12.97, lng: 77.59, radiusKm: 25 } });
  assert.deepEqual(wide, { q: 'paint', limit: FIND_WORK_LIMIT, kind: 'request' });
});

test('without a place there is one read and an empty query is left out', () => {
  const { near, wide } = findWorkSearches(null, 10, '');
  assert.equal(near, null);
  assert.equal(wide.q, undefined);
  assert.equal(wide.near, undefined);
});

test('the join keeps nearby pinned jobs and remote ones from the wide read', () => {
  const out = joinFindWork([job('a'), job('b')], [job('far'), job('r1', null, null), job('a')]);
  assert.deepEqual(out.map((j) => j.id), ['a', 'b', 'r1']);
});

test('a job both reads return shows once, and the wide read adds no pinned job', () => {
  const out = joinFindWork([job('a'), job('a')], [job('r1', null, null), job('r1', null, null), job('z')]);
  assert.deepEqual(out.map((j) => j.id), ['a', 'r1']);
});

test('with no nearby read the wide rows pass through unchanged', () => {
  const wide = [job('a'), job('r1', null, null)];
  assert.deepEqual(joinFindWork(null, wide), wide);
});
