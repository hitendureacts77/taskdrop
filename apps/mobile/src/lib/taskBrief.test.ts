import test from 'node:test';
import assert from 'node:assert/strict';
import { askBrief, askQuestions } from './taskBrief.ts';

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
