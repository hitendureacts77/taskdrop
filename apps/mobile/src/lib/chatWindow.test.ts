import test from 'node:test';
import assert from 'node:assert/strict';
import { closingLine, timeUntil } from './chatWindow.ts';

const now = Date.parse('2026-11-25T10:00:00Z');
const at = (ms: number) => new Date(now + ms).toISOString();

test('timeUntil words', () => {
  assert.equal(timeUntil(at(28 * 3600_000), now), '1 day 4 h');
  assert.equal(timeUntil(at(48 * 3600_000), now), '2 days');
  assert.equal(timeUntil(at(3 * 3600_000 + 5 * 60_000), now), '3 h');
  assert.equal(timeUntil(at(25 * 60_000), now), '25 min');
  assert.equal(timeUntil(at(-5000), now), 'a moment');
});

test('closingLine', () => {
  assert.equal(closingLine(at(28 * 3600_000), now), 'Chat closes in 1 day 4 h. Messages are deleted after that.');
  assert.match(closingLine(null, now), /closes soon/);
});
