import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeById } from './mergeById.ts';

type Row = { id: string; at: string; body?: string };
const at = (r: Row) => r.at;

test('a live row that arrived before the fetch is kept', () => {
  const live: Row[] = [{ id: 'c', at: '2026-11-01T10:03:00Z' }];
  const fetched: Row[] = [
    { id: 'a', at: '2026-11-01T10:01:00Z' },
    { id: 'b', at: '2026-11-01T10:02:00Z' },
  ];
  assert.deepEqual(mergeById(live, fetched, at).map((r) => r.id), ['a', 'b', 'c']);
});

test('a row both lists have appears once, and the fetched copy wins', () => {
  const live: Row[] = [{ id: 'a', at: '2026-11-01T10:01:00Z', body: 'live' }];
  const fetched: Row[] = [{ id: 'a', at: '2026-11-01T10:01:00Z', body: 'server' }];
  const out = mergeById(live, fetched, at);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.body, 'server');
});

test('chat order is oldest first even if the live row is older than the page', () => {
  const live: Row[] = [{ id: 'x', at: '2026-11-01T09:00:00Z' }];
  const fetched: Row[] = [{ id: 'y', at: '2026-11-01T10:00:00Z' }];
  assert.deepEqual(mergeById(live, fetched, at).map((r) => r.id), ['x', 'y']);
});

test('notifications order is newest first', () => {
  const live: Row[] = [{ id: 'n3', at: '2026-11-01T10:03:00Z' }];
  const fetched: Row[] = [
    { id: 'n2', at: '2026-11-01T10:02:00Z' },
    { id: 'n1', at: '2026-11-01T10:01:00Z' },
  ];
  assert.deepEqual(mergeById(live, fetched, at, 'newestFirst').map((r) => r.id), ['n3', 'n2', 'n1']);
});

test('rows with no readable time keep their arrival order', () => {
  const live: Row[] = [{ id: 'p', at: '' }];
  const fetched: Row[] = [{ id: 'q', at: 'not a date' }];
  assert.deepEqual(mergeById(live, fetched, at).map((r) => r.id), ['p', 'q']);
});

test('two empty lists give an empty list', () => {
  assert.deepEqual(mergeById([], [], at), []);
});
