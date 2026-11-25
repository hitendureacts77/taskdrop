import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLeftText, whenText, surfaceBars, promotionPriceMinor, daysLabel } from './promoteText.ts';

const NOW = new Date(2026, 10, 25, 10, 0, 0).getTime();

test('time left reads in days and hours, then hours, then minutes', () => {
  assert.equal(timeLeftText(new Date(NOW + (2 * 1440 + 5 * 60) * 60000).toISOString(), NOW), '2 days 5 h left');
  assert.equal(timeLeftText(new Date(NOW + 1440 * 60000).toISOString(), NOW), '1 day left');
  assert.equal(timeLeftText(new Date(NOW + 130 * 60000).toISOString(), NOW), '2 h 10 min left');
  assert.equal(timeLeftText(new Date(NOW + 12 * 60000).toISOString(), NOW), '12 min left');
  assert.equal(timeLeftText(new Date(NOW - 1000).toISOString(), NOW), 'Ended');
  assert.equal(timeLeftText(null, NOW), '');
});

test('when text says today, tomorrow or the date', () => {
  assert.equal(whenText(new Date(2026, 10, 25, 16, 30).toISOString(), NOW), 'today at 4:30 pm');
  assert.equal(whenText(new Date(2026, 10, 26, 0, 5).toISOString(), NOW), 'tomorrow at 12:05 am');
  assert.equal(whenText(new Date(2026, 10, 28, 9, 0).toISOString(), NOW), '28 Nov at 9:00 am');
  assert.equal(whenText(null, NOW), '');
});

test('surface bars skip zeros and scale to the largest', () => {
  const bars = surfaceBars({ list: 40, map: 10, home: 0, other: 99 });
  assert.deepEqual(bars.map((b) => [b.label, b.count, b.pct]), [['Find work', 40, 100], ['Map', 10, 25]]);
  assert.equal(surfaceBars({ list: 1 }, true)[0]!.label, 'Helpers list');
  assert.deepEqual(surfaceBars({}), []);
});

test('price is days times the flat day price', () => {
  assert.equal(promotionPriceMinor(3, 8000), 24000);
  assert.equal(daysLabel(1), '1 day');
  assert.equal(daysLabel(7), '7 days');
});
