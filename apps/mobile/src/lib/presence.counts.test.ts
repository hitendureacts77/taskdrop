import test from 'node:test';
import assert from 'node:assert/strict';
import { helpersLiveText, peopleCounts } from './presence.ts';

const now = Date.parse('2026-11-28T10:00:00Z');
const online = { last_seen_at: new Date(now - 30_000).toISOString() };
const away = { last_seen_at: new Date(now - 6 * 3600_000).toISOString() };

test('one count of helpers and of those active now', () => {
  assert.deepEqual(peopleCounts([online, away, away], now), { n: 3, live: 1 });
  assert.deepEqual(peopleCounts([], now), { n: 0, live: 0 });
});

test('the live pill says one number: online now, or near you when nobody is online (never a 0)', () => {
  assert.equal(helpersLiveText([online, away, away], now), '1 worker online now');
  assert.equal(helpersLiveText([online, online, away], now), '2 workers online now');
  assert.equal(helpersLiveText([away, away, away], now), '3 workers near you');
  assert.equal(helpersLiveText([away], now), '1 worker near you');
  assert.equal(helpersLiveText(Array.from({ length: 50 }, () => away), now), '50+ workers near you');
  assert.equal(helpersLiveText([], now), null);
  assert.equal(helpersLiveText(null, now), null);
});
