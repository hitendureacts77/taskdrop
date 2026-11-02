/**
 * Tests for the Sb-Forwarded-For helper (task 2.8b). Run from the repo root:
 *   node --experimental-strip-types --test supabase/functions/_shared/forwardedFor.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { secretKey, signInKey } from './forwardedFor.ts';

test('reads the default secret key from the JSON map', () => {
  assert.equal(secretKey('{"default":"sb_secret_abc"}'), 'sb_secret_abc');
  assert.equal(secretKey('{"other":"sb_secret_xyz"}'), 'sb_secret_xyz');
});

test('no map, a broken map or a non-secret key gives null', () => {
  assert.equal(secretKey(undefined), null);
  assert.equal(secretKey(''), null);
  assert.equal(secretKey('not json'), null);
  assert.equal(secretKey('{"default":"sb_publishable_abc"}'), null);
  assert.equal(secretKey('{"default":"eyJhbGciOi"}'), null);
});

test('with a secret key and an address, signs in with the secret key and names the address', () => {
  assert.deepEqual(signInKey('203.0.113.7', 'sb_secret_abc', 'anon'), {
    key: 'sb_secret_abc',
    headers: { 'sb-forwarded-for': '203.0.113.7' },
  });
});

test('without a secret key or an address, falls back to the anon key and no header', () => {
  assert.deepEqual(signInKey('203.0.113.7', null, 'anon'), { key: 'anon', headers: {} });
  assert.deepEqual(signInKey(null, 'sb_secret_abc', 'anon'), { key: 'anon', headers: {} });
});
