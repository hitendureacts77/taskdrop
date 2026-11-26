import test from 'node:test';
import assert from 'node:assert/strict';
import { FIND_WORK_LIMIT, REMOTE_LIMIT, capped, findWorkSearches, inReachWithoutArea, joinFindWork, matchesQuery, matchesSearch } from './findWorkRead.ts';

test('B156: with no area, Earn Home keeps only remote jobs; with an area, what the server sent', () => {
  const rows = [job('kl', 3.1, 101.7), job('r1', null, null), job('gurugram', 28.5, 77.1), job('r2', null, null)];
  assert.deepEqual(inReachWithoutArea(rows, false, 8).map((j) => j.id), ['r1', 'r2']);
  assert.deepEqual(inReachWithoutArea(rows, false, 1).map((j) => j.id), ['r1']);
  assert.deepEqual(inReachWithoutArea(rows, true, 3).map((j) => j.id), ['kl', 'r1', 'gurugram']);
});

test('B170: remote jobs come from the same read as the map, matched the same way', () => {
  const rows = [{ id: 'a', title: 'Logo design', description: null }, { id: 'b', title: 'Typing', description: 'Data ENTRY in Excel' }];
  assert.deepEqual(rows.filter((r) => matchesQuery(r, '')).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(rows.filter((r) => matchesQuery(r, '  data entry ')).map((r) => r.id), ['b']);
  assert.equal(REMOTE_LIMIT, FIND_WORK_LIMIT);
  assert.equal(capped(FIND_WORK_LIMIT, FIND_WORK_LIMIT), true);
  assert.equal(capped(40, FIND_WORK_LIMIT), false);
});

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

test('smart search: drop and exact ride along only with a query', () => {
  const { near, wide } = findWorkSearches({ lat: 1, lng: 2 }, 10, 'plumbr', { drop: ['leak'], exact: true });
  assert.deepEqual(wide.drop, ['leak']);
  assert.equal(wide.exact, true);
  assert.deepEqual(near?.drop, ['leak']);
  const none = findWorkSearches(null, 10, '', { drop: ['leak'], exact: true });
  assert.equal(none.wide.drop, undefined);
  assert.equal(none.wide.exact, undefined);
  assert.equal(findWorkSearches(null, 10, 'tap').wide.drop, undefined);
});

test('the map keeps a job found by meaning: ids win over the words, words stand in until ids are known', () => {
  const a = { id: 'a', title: 'Fix a dripping faucet', description: null };
  const b = { id: 'b', title: 'Logo design', description: null };
  const ids = new Set(['a']);
  assert.equal(matchesSearch(a, 'plumber', ids), true);
  assert.equal(matchesSearch(b, 'plumber', ids), false);
  assert.equal(matchesSearch(a, 'plumber', null), false);
  assert.equal(matchesSearch(b, 'logo', null), true);
  assert.equal(matchesSearch(b, '  ', ids), true);
});
