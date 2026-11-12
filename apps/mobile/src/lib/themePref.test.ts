import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThemePref } from './themePref.ts';

test('the three known choices pass through', () => {
  assert.equal(parseThemePref('light'), 'light');
  assert.equal(parseThemePref('dark'), 'dark');
  assert.equal(parseThemePref('system'), 'system');
});

test('anything else is System', () => {
  for (const v of [null, undefined, '', 'Dark', 'blue', 1, {}]) {
    assert.equal(parseThemePref(v), 'system');
  }
});
