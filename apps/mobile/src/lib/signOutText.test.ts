import test from 'node:test';
import assert from 'node:assert/strict';
import { signOutMessage } from './signOutText.ts';

test('W2-16: the sign-out question lists every sign-in method the person has', () => {
  assert.equal(
    signOutMessage({ phone: true, google: false, username: true }),
    'You’ll need your phone number or your username and password to sign back in. Your tasks and wallet stay safe.',
  );
  assert.match(signOutMessage({ phone: true, google: true, username: true }), /your phone number, your Google account or your username and password/);
  assert.match(signOutMessage({ phone: false, google: true, username: false }), /^You’ll need your Google account to/);
});

test('while the methods are still loading, no method is guessed', () => {
  assert.doesNotMatch(signOutMessage(null), /Google|phone/);
});
