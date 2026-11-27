import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalLabel, hasExact, isPicked, pickView, profileView, searchItems, showAllLabel, tidy, type CatalogItem } from './catalogPick.ts';

const list: CatalogItem[] = Array.from({ length: 20 }, (_, i) => ({ id: `id${i}`, label: `Skill ${i}`, uses: 100 - i, source: 'builtin' }));

test('shows the top 12', () => {
  const v = pickView(list, []);
  assert.equal(v.shown.length, 12);
  assert.equal(v.total, 20);
  assert.ok(v.hasMore);
});

test('a pick outside the top stays visible, in rank order', () => {
  const v = pickView(list, ['skill 15', 'Skill 3']);
  assert.equal(v.shown.length, 13);
  assert.equal(v.shown[12]?.label, 'Skill 15');
});

test('an unknown pick is still shown', () => {
  const v = pickView(list, ['Dog walking']);
  assert.equal(v.shown.at(-1)?.label, 'Dog walking');
  assert.equal(v.total, 20);
});

test('short list has no show-all', () => {
  assert.equal(pickView(list.slice(0, 5), []).hasMore, false);
});

test('case-insensitive matching', () => {
  assert.ok(isPicked(['PAINTING'], 'Painting'));
  assert.equal(canonicalLabel(list, 'skill 2'), 'Skill 2');
  assert.equal(canonicalLabel(list, '  new thing '), 'new thing');
});

test('profile view puts picks first', () => {
  const p = profileView(list, ['Skill 9', 'Skill 1']);
  assert.deepEqual(p.picked.map((x) => x.label), ['Skill 9', 'Skill 1']);
  assert.equal(p.rest.length, 18);
  assert.equal(p.rest[0]?.label, 'Skill 0');
});

test('search: starts-with before contains', () => {
  const items: CatalogItem[] = [
    { id: 'a', label: 'Web design', uses: 5, source: 'builtin' },
    { id: 'b', label: 'Design', uses: 1, source: 'builtin' },
  ];
  assert.deepEqual(searchItems(items, 'des').map((x) => x.id), ['b', 'a']);
  assert.equal(searchItems(items, '').length, 2);
  assert.ok(hasExact(items, ' DESIGN '));
});

test('labels and tidy', () => {
  assert.equal(showAllLabel(31, 'skill'), 'Show all 31 skills');
  assert.equal(showAllLabel(15, 'category'), 'Show all 15 categories');
  assert.equal(tidy('  dog   walking '), 'Dog walking');
});
