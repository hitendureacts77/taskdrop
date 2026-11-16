import test from 'node:test';
import assert from 'node:assert/strict';
import { onSide, unreadSummary, type AlertSide } from './unread.ts';

const rows = [
  { id: 'a', kind: 'offer', read_at: null },
  { id: 'b', kind: 'message', read_at: null },
  { id: 'c', kind: 'message', read_at: '2026-11-16T10:00:00Z' },
  { id: 'd', kind: 'payment', read_at: null },
  { id: 'e', kind: 'message', read_at: null },
];
const sides = new Map<string, AlertSide>([
  ['a', 'poster'],
  ['b', 'poster'],
  ['d', 'worker'],
  ['e', 'both'],
]);

test('an alert with no known side shows on both sides', () => {
  assert.equal(onSide('zzz', sides, 'poster'), true);
  assert.equal(onSide('d', sides, 'poster'), false);
});

test('the bell counts what the list shows on this side (W3-12)', () => {
  assert.deepEqual(unreadSummary(rows, sides, 'poster'), { total: 3, messages: 2 });
  assert.deepEqual(unreadSummary(rows, sides, 'worker'), { total: 2, messages: 1 });
  assert.deepEqual(unreadSummary([], sides, 'worker'), { total: 0, messages: 0 });
});
