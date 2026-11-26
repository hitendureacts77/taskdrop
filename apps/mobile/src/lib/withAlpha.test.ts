import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAlpha } from './withAlpha.ts';

test('a six-digit colour becomes rgba with the alpha', () => {
  assert.equal(withAlpha('#16191C', 0.92), 'rgba(22,25,28,0.92)');
  assert.equal(withAlpha('#FFFFFF', 0.92), 'rgba(255,255,255,0.92)');
});

test('a three-digit colour is widened first', () => {
  assert.equal(withAlpha('#fff', 0.5), 'rgba(255,255,255,0.5)');
});

test('the alpha is kept between 0 and 1', () => {
  assert.equal(withAlpha('#000000', 2), 'rgba(0,0,0,1)');
  assert.equal(withAlpha('#000000', -1), 'rgba(0,0,0,0)');
});

test('anything that is not a hex colour comes back unchanged', () => {
  assert.equal(withAlpha('rgba(1,2,3,0.4)', 0.9), 'rgba(1,2,3,0.4)');
  assert.equal(withAlpha('red', 0.9), 'red');
});
