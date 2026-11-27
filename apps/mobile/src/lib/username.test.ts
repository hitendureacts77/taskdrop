import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUsername, gateShouldOpen, hasUsername, signInRouteFor, usernameFormatOk } from './username.ts';

test('the username rules are the onboarding ones: 3 to 20 of a-z, 0-9 and _', () => {
  for (const ok of ['ravi', 'ravi_fixes', 'abc', 'a1234567890123456789']) assert.equal(usernameFormatOk(ok), true, ok);
  for (const bad of ['', 'ab', 'Ravi', 'ravi k', 'ravi-k', 'a12345678901234567890']) assert.equal(usernameFormatOk(bad), false, bad);
  assert.equal(cleanUsername(' Ravi-K.Fixes! '), 'ravikfixes');
  assert.equal(cleanUsername('x'.repeat(30)).length, 20);
});

test('sign-in lands on setup for a first run, the gate for a finished setup with no username, Home otherwise', () => {
  assert.equal(signInRouteFor(null), 'setup');
  assert.equal(signInRouteFor({ onboarded_at: null, username: null }), 'setup');
  assert.equal(signInRouteFor({ onboarded_at: null, username: 'ravi' }), 'setup');
  assert.equal(signInRouteFor({ onboarded_at: '2026-11-01T00:00:00Z', username: null }), 'username');
  assert.equal(signInRouteFor({ onboarded_at: '2026-11-01T00:00:00Z', username: '' }), 'username');
  assert.equal(signInRouteFor({ onboarded_at: '2026-11-01T00:00:00Z', username: 'ravi' }), 'home');
});

test('the gate opens over any app screen for a profile with no username, a half-finished setup included', () => {
  const none = { onboarded_at: null, username: null };
  for (const screen of ['home', 'aiPost', 'taskDetail', 'chat', 'explore', 'profile', 'account']) {
    assert.equal(gateShouldOpen(screen, none), true, screen);
    assert.equal(gateShouldOpen(screen, { onboarded_at: '2026-11-01T00:00:00Z', username: null }), true, screen);
  }
});

test('the gate never covers sign-in, setup, itself or the public pages', () => {
  const none = { username: null };
  for (const screen of ['splash', 'intro', 'welcome', 'signup', 'setup', 'pickUsername', 'terms', 'privacy', 'support', 'copyright']) {
    assert.equal(gateShouldOpen(screen, none), false, screen);
  }
});

test('a profile with a username, or one that could not be read, never opens the gate', () => {
  assert.equal(gateShouldOpen('home', { username: 'ravi' }), false);
  assert.equal(gateShouldOpen('home', null), false);
  assert.equal(gateShouldOpen('home', undefined), false);
  assert.equal(hasUsername({ username: 'ravi' }), true);
  assert.equal(hasUsername({}), false);
});
