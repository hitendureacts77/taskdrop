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

test('the live pill says both numbers, so "active now" never contradicts "within 5 km"', () => {
  assert.equal(helpersLiveText([online, away, away], now), '1 of 3 helpers active now');
  assert.equal(helpersLiveText([online], now), '1 of 1 helper active now');
  assert.equal(helpersLiveText([], now), null);
  assert.equal(helpersLiveText(null, now), null);
});
