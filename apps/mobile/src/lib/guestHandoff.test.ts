import assert from 'node:assert/strict';
import test from 'node:test';
import { HANDOFF_WINDOW_MS, handoffFresh } from './guestHandoff.ts';

const NOW = Date.parse('2026-11-05T10:00:00Z');

test('the pop-up sign-in page open right now is always the guest themself', () => {
  assert.equal(handoffFresh(true, null, NOW), true);
});

test('a mark on the device counts only for a short while', () => {
  assert.equal(handoffFresh(false, String(NOW - 60_000), NOW), true);
  assert.equal(handoffFresh(false, String(NOW - HANDOFF_WINDOW_MS + 1), NOW), true);
  assert.equal(handoffFresh(false, String(NOW - HANDOFF_WINDOW_MS), NOW), false);
  assert.equal(handoffFresh(false, String(NOW - 24 * 3600_000), NOW), false, 'yesterday the next person may be signing in');
});

test('the window is ten minutes: a Google round trip fits, a mark left over an app kill for half an hour does not', () => {
  assert.equal(HANDOFF_WINDOW_MS, 10 * 60_000);
  assert.equal(handoffFresh(false, String(NOW - 9 * 60_000), NOW), true);
  assert.equal(handoffFresh(false, String(NOW - 11 * 60_000), NOW), false);
  assert.equal(handoffFresh(false, String(NOW - 30 * 60_000 + 1), NOW), false);
});

test('no mark, a broken one or one far in the future is not a hand-off', () => {
  for (const bad of [null, undefined, '', 'x', '0', '-5', String(NOW + 10 * 60_000)]) {
    assert.equal(handoffFresh(false, bad, NOW), false, String(bad));
  }
  assert.equal(handoffFresh(false, String(NOW + 30_000), NOW), true, 'a small clock difference is fine');
});
