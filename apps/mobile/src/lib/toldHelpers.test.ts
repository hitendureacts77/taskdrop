import test from 'node:test';
import assert from 'node:assert/strict';
import { countToldHelpers, helperDoes, toldLine, TOLD_LIMIT } from './toldHelpers.ts';

const h = (skills: string[], cat: string | null = null) => ({ skills, top_service: cat ? { category: cat } : null });

test('counts only helpers who do the category', () => {
  const list = [h(['Plumbing']), h(['Cleaning']), h([], 'Plumbing'), h(['Plumbing services'])];
  assert.equal(countToldHelpers(list, 'Plumbing').count, 3);
  assert.equal(helperDoes(h(['Cleaning']), 'Plumbing'), false);
});

test('no category counts every nearby helper', () => {
  assert.equal(countToldHelpers([h(['A']), h(['B'])], null).count, 2);
});

test('a full list is "at least"', () => {
  const list = Array.from({ length: TOLD_LIMIT }, () => h(['Plumbing']));
  const r = countToldHelpers(list, 'Plumbing');
  assert.equal(r.atLeast, true);
  assert.match(toldLine(r, 'Kondapur', 'Plumbing'), /^100\+ helpers near Kondapur who do plumbing/);
});

test('wording: one, many, zero', () => {
  assert.match(toldLine({ count: 1, atLeast: false }, 'Kondapur', 'Plumbing'), /^1 helper near Kondapur who do plumbing can see/);
  assert.match(toldLine({ count: 12, atLeast: false }, null, null), /^12 helpers near you can see/);
  assert.match(toldLine({ count: 0, atLeast: false }, 'Kondapur', 'Plumbing'), /^No helpers near Kondapur who do plumbing yet\. Share/);
});
