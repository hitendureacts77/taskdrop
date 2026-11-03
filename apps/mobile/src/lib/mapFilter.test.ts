import test from 'node:test';
import assert from 'node:assert/strict';
import { chipCategories, chipLabel, matchesSearch } from './mapFilter.ts';

test('an empty search matches everything', () => {
  assert.equal(matchesSearch('', ['Fix my fan']), true);
  assert.equal(matchesSearch('   ', []), true);
});

test('every word typed must show up in some field, in any case or order', () => {
  const fields = ['Deep clean 2BHK', 'Home Services', 'Madhapur'];
  assert.equal(matchesSearch('clean madhapur', fields), true);
  assert.equal(matchesSearch('MADHAPUR deep', fields), true);
  assert.equal(matchesSearch('clean kondapur', fields), false);
});

test('punctuation and accents do not get in the way', () => {
  assert.equal(matchesSearch('ac', ['A/C repair']), true);
  assert.equal(matchesSearch('cafe', ['Café pickup']), true);
  assert.equal(matchesSearch('a/c', ['AC service']), true);
});

test('missing fields are skipped', () => {
  assert.equal(matchesSearch('plumber', [null, undefined, 'Plumber']), true);
  assert.equal(matchesSearch('plumber', [null, undefined]), false);
});

test('chips are the categories on the map, busiest first, never Other or empty', () => {
  const got = chipCategories(['Tech & Websites', 'Home Services', null, 'Home Services', 'Other', 'Errands & Delivery', '']);
  assert.deepEqual(got, ['Home Services', 'Tech & Websites', 'Errands & Delivery']);
});

test('chips stop at the limit', () => {
  assert.deepEqual(chipCategories(['a', 'b', 'c', 'd'], 2), ['a', 'b']);
});

test('a chip shows the first half of a long category', () => {
  assert.equal(chipLabel('Repairs & Maintenance'), 'Repairs');
  assert.equal(chipLabel('Other'), 'Other');
});
