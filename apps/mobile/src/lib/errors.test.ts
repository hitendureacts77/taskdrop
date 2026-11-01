/**
 * Tests for how failed calls are told apart. Run from the repo root:
 *   node --experimental-strip-types --test apps/mobile/src/lib/errors.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCOUNT_CLOSED, apiFailureKind, friendlyMessage } from './errors.ts';

test('a closed account is told so, not "no permission" or a blank (B6)', () => {
  assert.equal(ACCOUNT_CLOSED, 'This account is closed. Contact support.');
  assert.equal(friendlyMessage({ message: 'User is banned', code: 'user_banned', status: 403 }), ACCOUNT_CLOSED);
  assert.equal(friendlyMessage({ message: 'User is banned' }), ACCOUNT_CLOSED);
  assert.equal(apiFailureKind({ message: 'User is banned', code: 'user_banned', status: 403 }), 'refused');
});

test('no network is offline, not a bug', () => {
  assert.equal(apiFailureKind({ message: 'Network request failed' }), 'offline');
  assert.equal(apiFailureKind({ message: 'TypeError: Failed to fetch' }), 'offline');
});

test('an ended session is signed_out', () => {
  assert.equal(apiFailureKind({ message: 'JWT expired', status: 401 }), 'signed_out');
});

test('a refusal written on purpose, a duplicate and a permission error are refused', () => {
  assert.equal(apiFailureKind({ message: 'Not enough money in your wallet', code: 'P0001' }), 'refused');
  assert.equal(apiFailureKind({ message: 'duplicate key value', code: '23505' }), 'refused');
  assert.equal(apiFailureKind({ message: 'permission denied for table x', code: '42501' }), 'refused');
});

test('anything we have no wording for is unexpected', () => {
  assert.equal(apiFailureKind({ message: 'relation "x" does not exist', code: '42P01' }), 'unexpected');
  assert.equal(apiFailureKind({ message: 'boom', status: 500 }), 'unexpected');
});
