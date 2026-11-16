import test from 'node:test';
import assert from 'node:assert/strict';
import { lengthHint } from './fieldHint.ts';

test('W3-16: an empty box says what to write and the least length', () => {
  assert.equal(lengthHint('', 10, 'what you did'), 'Write what you did to continue (at least 10 characters).');
  assert.equal(lengthHint('   ', 10, 'what you did'), 'Write what you did to continue (at least 10 characters).');
});

test('W3-16: a short box counts what is still missing', () => {
  assert.equal(lengthHint('abcdefg', 10, 'x'), '3 more characters needed to continue.');
  assert.equal(lengthHint('abcdefghi', 10, 'x'), '1 more character needed to continue.');
});

test('W3-16: enough text, no line', () => {
  assert.equal(lengthHint('abcdefghij', 10, 'x'), null);
  assert.equal(lengthHint('  abcdefghij  ', 10, 'x'), null);
});
