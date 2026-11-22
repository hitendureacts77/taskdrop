import test from 'node:test';
import assert from 'node:assert/strict';
import { homeTemplates, templateCategories, templatesIn } from './homeTemplates.ts';
import { CATEGORIES, TEMPLATES } from './taskBrief.ts';

test('every template gets a real category and a day', () => {
  const list = homeTemplates(TEMPLATES);
  assert.equal(list.length, TEMPLATES.length);
  for (const x of list) {
    assert.ok((CATEGORIES as readonly string[]).includes(x.category), x.key);
    assert.ok(['today', '2days', 'week'].includes(x.when), x.key);
    assert.notEqual(x.category, 'Other', `${x.key} has no category`);
  }
});

test('chips list only categories with templates, and For you shows all', () => {
  const list = homeTemplates(TEMPLATES);
  const chips = templateCategories(list, CATEGORIES);
  assert.ok(chips.length > 3);
  for (const c of chips) assert.ok(templatesIn(list, c).length > 0);
  assert.equal(templatesIn(list, null).length, list.length);
});
