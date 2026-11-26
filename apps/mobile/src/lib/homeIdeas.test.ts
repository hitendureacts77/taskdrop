import test from 'node:test';
import assert from 'node:assert/strict';
import { EVERYDAY, EVERYDAY_CHIP, FOR_YOU, IDEA_CHIPS, POSTER_IDEAS, QUICK_TEMPLATES, ideasIn, offerLine } from './homeIdeas.ts';
import { homeTemplates } from './homeTemplates.ts';
import { TEMPLATES } from './taskBrief.ts';

const templates = homeTemplates(TEMPLATES);

test('one chip per group, plus For you, Quick templates and Everyday (decision 1)', () => {
  assert.equal(IDEA_CHIPS[0], FOR_YOU);
  assert.ok(IDEA_CHIPS.includes(QUICK_TEMPLATES));
  assert.ok(IDEA_CHIPS.includes(EVERYDAY_CHIP));
  for (const g of POSTER_IDEAS) assert.ok(IDEA_CHIPS.includes(g.group), g.group);
  assert.equal(new Set(IDEA_CHIPS).size, IDEA_CHIPS.length);
  assert.deepEqual(IDEA_CHIPS.slice(0, 6), ['For you', 'Money back', 'Be there for me', 'Before I buy', 'Quick templates', 'Everyday']);
});

test('nothing from the three old blocks is lost', () => {
  const titles = new Set(IDEA_CHIPS.flatMap((c) => ideasIn(c, templates).map((x) => x.title)));
  for (const g of POSTER_IDEAS) for (const x of g.ideas) assert.ok(titles.has(x.title), x.title);
  for (const x of EVERYDAY) assert.ok(titles.has(x.title), x.title);
  for (const x of templates) assert.ok(titles.has(x.title), x.key);
  assert.equal(ideasIn(QUICK_TEMPLATES, templates).length, TEMPLATES.length);
  assert.equal(ideasIn(EVERYDAY_CHIP, templates).length, 9);
});

test('For you shows the drawn picks, at least four, each with a prompt', () => {
  const mine = ideasIn(FOR_YOU, templates);
  assert.ok(mine.length >= 4);
  assert.deepEqual(
    mine.slice(0, 4).map((x) => x.title),
    ['Get my PF out', 'Watch my plot', 'Make a call for me', 'Hand off a task'],
  );
  for (const x of mine) assert.ok(x.prompt.length > 0, x.title);
  assert.deepEqual(ideasIn('no such chip', templates), mine);
});

test('Everyday tiles use the template words where there is one', () => {
  const tiles = ideasIn(EVERYDAY_CHIP, templates);
  const handOff = tiles.find((x) => x.title === 'Hand off a task');
  assert.equal(handOff?.prompt, TEMPLATES.find((x) => x.key === 'offload')?.prompt);
  assert.equal(tiles.find((x) => x.title === 'Queue for me')?.prompt, 'Stand in the queue for me at ');
});

test('keys are unique inside a chip, and templates keep their key for the testID', () => {
  for (const c of IDEA_CHIPS) {
    const keys = ideasIn(c, templates).map((x) => x.key);
    assert.equal(new Set(keys).size, keys.length, c);
  }
  assert.ok(ideasIn(QUICK_TEMPLATES, templates).every((x) => x.templateKey));
});

test('offerLine', () => {
  assert.equal(offerLine('from ₹800'), '₹800+');
  assert.equal(offerLine('₹500 a month'), '₹500 a month');
});
