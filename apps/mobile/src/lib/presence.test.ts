import test from 'node:test';
import assert from 'node:assert/strict';
import { presenceOf } from './presence.ts';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3_600_000;

test('no last seen reads as not active yet', () => {
  assert.deepEqual(presenceOf(null, NOW), { online: false, label: 'Not active yet' });
});

test('seen within three minutes is active now', () => {
  assert.deepEqual(presenceOf(ago(60_000), NOW), { online: true, label: 'Active now' });
});

test('minutes and hours away', () => {
  assert.equal(presenceOf(ago(10 * 60_000), NOW).label, 'Away · 10 min');
  assert.equal(presenceOf(ago(2 * H), NOW).label, 'Away · 2h');
  assert.equal(presenceOf(ago(2 * H + 5 * 60_000), NOW).label, 'Away · 2h 5m');
});

test('days away are rounded down, never up', () => {
  assert.equal(presenceOf(ago(24 * H), NOW).label, 'Last seen yesterday');
  assert.equal(presenceOf(ago(36 * H), NOW).label, 'Last seen yesterday');
  assert.equal(presenceOf(ago(47 * H), NOW).label, 'Last seen yesterday');
  assert.equal(presenceOf(ago(48 * H), NOW).label, 'Last seen 2 days ago');
  assert.equal(presenceOf(ago(100 * H), NOW).label, 'Last seen 4 days ago');
});
