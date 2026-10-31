import test from 'node:test';
import assert from 'node:assert/strict';
import { askBrief, askQuestions, quantityFactor } from './taskBrief.ts';

const categoryOf = (prompt: string) => askBrief(prompt, [], 'friendly').category;
const wordsOf = (prompt: string) => JSON.stringify(askBrief(prompt, [], 'friendly')) + JSON.stringify(askQuestions(prompt));

test('a bare "phone" does not turn a post into phone repair (2026-10-28 phone run)', () => {
  for (const s of [
    'help me carry a sofa phone run',
    'Phone number list typing',
    'Answer a customer over the phone for two hours',
    'Collect my parcel from the post office, phone me when you reach',
  ]) {
    assert.notEqual(categoryOf(s), 'Repairs & Maintenance', s);
    assert.ok(!/phone or laptop repair/i.test(wordsOf(s)), s);
  }
});

test('real phone and laptop repairs are still recognised', () => {
  for (const s of [
    'my phone screen is cracked',
    'phone not charging, need repair',
    'please fix my phone',
    'iphone battery draining fast',
    'laptop is slow and hanging',
  ]) {
    assert.equal(categoryOf(s), 'Repairs & Maintenance', s);
  }
});

test('the usual price follows the quantity in the description (D6)', () => {
  assert.equal(quantityFactor('build a website').factor, 1);
  const two = quantityFactor('build a 2 pages website').factor;
  const ten = quantityFactor('build a 10 pages website').factor;
  assert.ok(two > 1 && ten > two, 'more pages cost more');
  assert.ok(ten < 10, 'but not in a straight line');
  assert.equal(quantityFactor('50000 pages').factor, 8, 'a typo cannot run away');
  assert.equal(quantityFactor('clean 3 rooms', true).factor, 1, 'BHK already counts the rooms');
  assert.match(quantityFactor('type 1500 words').note, /1500 words/);
  const small = askBrief('Build a 1 page website for my shop', [], 'friendly');
  const big = askBrief('Build a 12 pages website for my shop', [], 'friendly');
  assert.ok(big.budgetMaxInr > small.budgetMaxInr, 'the range moves with the size');
  assert.match(big.budgetWhy ?? '', /Scaled for 12 pages/);
});
