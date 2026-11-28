// node --experimental-strip-types --test apps/mobile/src/lib/postTemplates.test.ts
// Ideas board: "Let me save a task as a template".
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_TEMPLATES, addTemplate, clearTemplates, listTemplates, parseTemplates, removeTemplate, saveTemplate, templatesKey } from './postTemplates.ts';

function fakeStorage(start: Record<string, string> = {}) {
  const items = new Map(Object.entries(start));
  return {
    items,
    getItem: async (k: string) => items.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      items.set(k, v);
    },
    removeItem: async (k: string) => {
      items.delete(k);
    },
  };
}

test('a saved template comes back for the same account only', async () => {
  const s = fakeStorage();
  assert.equal(await saveTemplate(s, 'u1', { title: ' Clean my balcony ', description: 'Two chairs, one plant', category: 'Home Services', budget: 499.6 }), true);
  const mine = await listTemplates(s, 'u1');
  assert.equal(mine.length, 1);
  assert.deepEqual({ ...mine[0], id: 'x', savedAt: 0 }, { id: 'x', title: 'Clean my balcony', description: 'Two chairs, one plant', category: 'Home Services', budget: 500, savedAt: 0 });
  assert.deepEqual(await listTemplates(s, 'u2'), []);
});

test('the same title replaces the old one; the newest sits first; the list stays short', () => {
  let rows = addTemplate([], { title: 'A' }, 1);
  rows = addTemplate(rows, { title: 'B' }, 2);
  rows = addTemplate(rows, { title: 'a', budget: 300 }, 3);
  assert.deepEqual(rows.map((r) => [r.title, r.budget]), [['a', 300], ['B', 0]]);
  for (let i = 0; i < 20; i++) rows = addTemplate(rows, { title: `T${i}` }, 10 + i);
  assert.equal(rows.length, MAX_TEMPLATES);
  assert.equal(rows[0]!.title, 'T19');
});

test('no title, nothing kept; odd stored data is dropped, not shown', () => {
  assert.deepEqual(addTemplate([], { title: '   ' }), []);
  assert.deepEqual(parseTemplates('not json'), []);
  assert.deepEqual(parseTemplates('{"a":1}'), []);
  const rows = parseTemplates(JSON.stringify([{ id: 't1', title: 'Ok', budget: -5, savedAt: 1 }, { id: 2, title: 'bad id' }, null]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.budget, 0);
  assert.equal(rows[0]!.category, 'Other');
});

test('remove one, and sign-out clears them all', async () => {
  const s = fakeStorage();
  await saveTemplate(s, 'u1', { title: 'One' });
  const [one] = await listTemplates(s, 'u1');
  await saveTemplate(s, 'u1', { title: 'Two' });
  await removeTemplate(s, 'u1', one!.id);
  assert.deepEqual((await listTemplates(s, 'u1')).map((r) => r.title), ['Two']);
  await clearTemplates(s, 'u1');
  assert.equal(s.items.has(templatesKey('u1')), false);
});

test('a storage that fails never throws', async () => {
  const broken = {
    getItem: async () => {
      throw new Error('no');
    },
    setItem: async () => {
      throw new Error('no');
    },
    removeItem: async () => {
      throw new Error('no');
    },
  };
  assert.deepEqual(await listTemplates(broken, 'u1'), []);
  assert.equal(await saveTemplate(broken, 'u1', { title: 'X' }), false);
  await clearTemplates(broken, 'u1');
});
