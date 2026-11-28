import test from 'node:test';
import assert from 'node:assert/strict';
import { hasEarnings, trimToCovered, weekStart, weeklyEarnings } from './weeklyEarnings.ts';

// Thursday 27 Nov 2026, noon local time.
const now = new Date(2026, 10, 27, 12).getTime();
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m, d, h).toISOString();

test('weekStart snaps to the Monday at local midnight', () => {
  assert.equal(weekStart(now), new Date(2026, 10, 23).getTime());
  // A Sunday belongs to the week that started six days before.
  assert.equal(weekStart(new Date(2026, 10, 29, 23).getTime()), new Date(2026, 10, 23).getTime());
  // A Monday is its own week start.
  assert.equal(weekStart(new Date(2026, 10, 23, 0, 5).getTime()), new Date(2026, 10, 23).getTime());
});

test('weeklyEarnings gives the last N weeks, oldest first, ending this week', () => {
  const w = weeklyEarnings([], now, 8);
  assert.equal(w.length, 8);
  assert.equal(w[7]!.start, new Date(2026, 10, 23).getTime());
  assert.equal(w[7]!.label, '23 Nov');
  assert.equal(w[0]!.start, new Date(2026, 9, 5).getTime());
  assert.equal(hasEarnings(w), false);
});

test('only released money counts, in the week it was released', () => {
  const rows = [
    { kind: 'released', amount_minor: 50000, created_at: at(2026, 10, 24) },
    { kind: 'released', amount_minor: 25000, created_at: at(2026, 10, 27, 9) },
    { kind: 'released', amount_minor: 10000, created_at: at(2026, 10, 18) },
    { kind: 'on_hold', amount_minor: 99900, created_at: at(2026, 10, 25) },
    { kind: 'refunded', amount_minor: 99900, created_at: at(2026, 10, 25) },
    { kind: 'paid', amount_minor: 99900, created_at: at(2026, 10, 25) },
  ];
  const w = weeklyEarnings(rows, now, 4);
  assert.deepEqual(
    w.map((x) => x.minor),
    [0, 0, 10000, 75000],
  );
  assert.equal(hasEarnings(w), true);
});

test('rows outside the range or malformed are left out', () => {
  const rows = [
    { kind: 'released', amount_minor: 10000, created_at: at(2025, 0, 1) },
    { kind: 'released', amount_minor: 10000, created_at: 'not a date' },
    { kind: 'released', amount_minor: -500, created_at: at(2026, 10, 24) },
    { kind: 'released', amount_minor: 10000, created_at: at(2026, 11, 25) },
  ];
  assert.equal(hasEarnings(weeklyEarnings(rows, now, 8)), false);
});

test('a full (capped) ledger drops the weeks it may not cover', () => {
  const rows = [
    { kind: 'released', amount_minor: 100, created_at: at(2026, 10, 25) },
    { kind: 'paid', amount_minor: 100, created_at: at(2026, 10, 11) }, // oldest row: week of 9 Nov
  ];
  const all = weeklyEarnings(rows, now, 8);
  assert.equal(trimToCovered(all, rows, false).length, 8);
  const kept = trimToCovered(all, rows, true);
  assert.deepEqual(kept.map((w) => w.label), ['16 Nov', '23 Nov']);
  // Everything in one week: this week alone is kept.
  const same = [{ kind: 'released', amount_minor: 1, created_at: at(2026, 10, 24) }];
  assert.equal(trimToCovered(weeklyEarnings(same, now, 8), same, true).length, 1);
});

test('the week count is clamped', () => {
  assert.equal(weeklyEarnings([], now, 0).length, 1);
  assert.equal(weeklyEarnings([], now, 500).length, 52);
});
