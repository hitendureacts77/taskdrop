import test from 'node:test';
import assert from 'node:assert/strict';
import { introMode } from './introRoute.ts';


test('the intro opened by hand never asks a signed-in person to sign up', () => {
  assert.equal(introMode({ replay: false, signedIn: false }), 'first');
  assert.equal(introMode({ replay: true, signedIn: false }), 'guest-replay');
  assert.equal(introMode({ replay: true, signedIn: true }), 'member-replay');
});
