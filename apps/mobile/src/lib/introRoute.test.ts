import test from 'node:test';
import assert from 'node:assert/strict';
import { afterSplash, introMode } from './introRoute.ts';

test('a fresh install goes to the intro, every later start to sign-in', () => {
  assert.equal(afterSplash(false), 'intro');
  assert.equal(afterSplash(true), 'welcome');
});

test('the intro opened by hand never asks a signed-in person to sign up', () => {
  assert.equal(introMode({ replay: false, signedIn: false }), 'first');
  assert.equal(introMode({ replay: true, signedIn: false }), 'guest-replay');
  assert.equal(introMode({ replay: true, signedIn: true }), 'member-replay');
});
