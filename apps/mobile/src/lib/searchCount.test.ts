import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCtaLabel, SEARCH_COUNT_LIMIT } from './searchCount.ts';

test('counts under the cap are exact', () => {
  assert.equal(searchCtaLabel(null, false), 'Searching…');
  assert.equal(searchCtaLabel(0, false), 'Show 0 tasks');
  assert.equal(searchCtaLabel(1, false), 'Show 1 task');
  assert.equal(searchCtaLabel(59, false), 'Show 59 tasks');
});

test('a count that hits the cap says there are more', () => {
  assert.equal(SEARCH_COUNT_LIMIT, 60);
  assert.equal(searchCtaLabel(60, false), 'Show 60+ tasks');
  assert.equal(searchCtaLabel(75, false, 60), 'Show 60+ tasks');
});

test('a failed count is neutral, never zero', () => {
  assert.equal(searchCtaLabel(null, true), 'Show tasks');
  assert.equal(searchCtaLabel(0, true), 'Show tasks');
});
