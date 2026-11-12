import test from 'node:test';
import assert from 'node:assert/strict';
import { countOf } from './plural.ts';

test('one is singular, everything else is plural', () => {
  assert.equal(countOf(1, 'review'), '1 review');
  assert.equal(countOf(0, 'review'), '0 reviews');
  assert.equal(countOf(2, 'review'), '2 reviews');
  assert.equal(countOf(60, 'task'), '60 tasks');
});

test('an irregular plural can be given', () => {
  assert.equal(countOf(1, 'person', 'people'), '1 person');
  assert.equal(countOf(3, 'person', 'people'), '3 people');
});
