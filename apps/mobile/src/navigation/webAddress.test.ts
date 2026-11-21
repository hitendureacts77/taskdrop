import test from 'node:test';
import assert from 'node:assert/strict';
import { pageFromAddress, pathForScreen, titleForScreen } from './webAddress.ts';

test('B171: /privacy, /terms, /support and /copyright open their page on load', () => {
  assert.equal(pageFromAddress('/privacy', ''), 'privacy');
  assert.equal(pageFromAddress('/terms/', ''), 'terms');
  assert.equal(pageFromAddress('/Support', ''), 'support');
  assert.equal(pageFromAddress('/copyright', '?utm=x'), 'copyright');
  // The old ?page= links still work.
  assert.equal(pageFromAddress('/', '?page=terms'), 'terms');
});

test('B171: unknown paths and other pages still go Home', () => {
  assert.equal(pageFromAddress('/', ''), null);
  assert.equal(pageFromAddress('/nonexistent-page-xyz', ''), null);
  assert.equal(pageFromAddress('/.env', ''), null);
  assert.equal(pageFromAddress('/privacy/extra', ''), null);
  assert.equal(pageFromAddress('/', '?page=wallet'), null);
});

test('B171: the address follows the four public pages only', () => {
  assert.equal(pathForScreen('privacy', '/'), '/privacy');
  assert.equal(pathForScreen('privacy', '/privacy'), null);
  assert.equal(pathForScreen('home', '/privacy'), '/');
  assert.equal(pathForScreen('home', '/'), null);
  assert.equal(pathForScreen('wallet', '/get'), null);
});

test('B179: each main screen has its own tab title', () => {
  assert.equal(titleForScreen('wallet'), 'Wallet · TaskDrop');
  assert.equal(titleForScreen('explore', 'worker'), 'Find work · TaskDrop');
  assert.equal(titleForScreen('explore', 'poster'), 'Explore · TaskDrop');
  assert.equal(titleForScreen('privacy'), 'Privacy Policy · TaskDrop');
  assert.equal(titleForScreen('splash'), 'TaskDrop');
});

test('L1-17: every named screen gets its own tab title', () => {
  for (const [screen, name] of [['bigDay', 'Plan a big day'], ['regulars', 'My regulars'], ['promote', 'Promote a request'], ['disputes', 'My complaints'], ['profileEdit', 'Edit profile']] as const) {
    assert.equal(titleForScreen(screen), `${name} · TaskDrop`);
  }
});
