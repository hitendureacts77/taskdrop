import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordChangeAllowed } from './recentSignIn';

const now = Date.parse('2026-11-17T10:00:00Z');

test('a sign-in a few minutes ago may set a password', () => {
  assert.equal(passwordChangeAllowed('2026-11-17T09:50:00Z', now), true);
});

test('an old, missing or unreadable sign-in may not', () => {
  assert.equal(passwordChangeAllowed('2026-11-15T09:50:00Z', now), false);
  assert.equal(passwordChangeAllowed(null, now), false);
  assert.equal(passwordChangeAllowed('nonsense', now), false);
});
