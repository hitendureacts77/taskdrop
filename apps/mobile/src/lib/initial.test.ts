import test from 'node:test';
import assert from 'node:assert/strict';
import { initialOf } from './initial';

test('first letter is upper-cased', () => assert.equal(initialOf('asha'), 'A'));
test('an emoji is kept whole', () => assert.equal(initialOf('😀 Asha'), '😀'));
test('empty or missing gives the fallback', () => {
  assert.equal(initialOf(''), '?');
  assert.equal(initialOf(null, 'T'), 'T');
});
