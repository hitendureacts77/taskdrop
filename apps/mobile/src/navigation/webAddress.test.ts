import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isKnownPath, nameForScreen, NOT_FOUND_TITLE, pageFromAddress, pathForScreen, SITE_TITLE, titleForScreen } from './webAddress.ts';

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
  assert.equal(titleForScreen('splash'), SITE_TITLE);
  assert.equal(titleForScreen('swipe'), 'Start the work · TaskDrop');
});

test('3.6 T13 #5: every registered screen has its own tab title, never bare "TaskDrop"', () => {
  const registry = readFileSync(new URL('./registry.tsx', import.meta.url), 'utf8');
  const block = registry.slice(registry.indexOf('export const REGISTRY'));
  const screens = [...block.matchAll(/^\s+([a-zA-Z]+): [A-Z]\w+Screen,$/gm)].map((m) => m[1]);
  assert.ok(screens.length > 40, `found only ${screens.length} screens in registry.tsx`);
  for (const s of screens.filter((x) => x !== 'splash')) {
    const title = titleForScreen(s);
    assert.ok(title !== 'TaskDrop' && title !== SITE_TITLE && title.endsWith(' · TaskDrop'), `${s} has no title of its own`);
  }
});

test('3.6 T13 #8: only the real addresses are known; anything else is "Page not found"', () => {
  for (const p of ['/', '', '/index.html', '/get', '/get/', '/terms', '/privacy', '/support/', '/copyright']) assert.equal(isKnownPath(p), true, p);
  for (const p of ['/Privacy', '/this-page-does-not-exist-xyz', '/wallet', '/terms/x', '/sitemap.xml', '/screen/home']) assert.equal(isKnownPath(p), false, p);
  assert.equal(NOT_FOUND_TITLE, 'Page not found · TaskDrop');
});

test('the desktop page header names a screen plainly, and gives null for one with no name', () => {
  assert.equal(nameForScreen('wallet'), 'Wallet');
  assert.equal(nameForScreen('myTasks', 'worker'), 'My work');
  assert.equal(nameForScreen('myTasks', 'poster'), 'My tasks');
  assert.equal(nameForScreen('explore', 'worker'), 'Find work');
  assert.equal(nameForScreen('splash'), null);
});
