// node --experimental-strip-types --test apps/mobile/src/navigation/frame.test.ts
// B149: a guest opening Terms, Privacy or Copyright from Help keeps the app's frame.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PUBLIC, usesAuthFrame, usesFullPage } from './frame.ts';

test('B149 a guest (in the app) reads the public pages in the app frame', () => {
  for (const page of ['terms', 'privacy', 'copyright', 'support']) assert.equal(usesAuthFrame(page, true), false, page);
});

test('B149 a visitor with no account and no guest choice still gets the signed-out frame on public pages', () => {
  for (const page of PUBLIC) assert.equal(usesAuthFrame(page, false), true, page);
});

test('B149 sign-in screens always use the signed-out frame; app screens never do', () => {
  for (const inApp of [true, false]) {
    assert.equal(usesAuthFrame('signup', inApp), true);
    assert.equal(usesAuthFrame('home', inApp), false);
    assert.equal(usesAuthFrame('help', inApp), false);
  }
});

test('B149 ScreenHost counts a guest as in the app for both desktop and tablet frames', () => {
  const host = readFileSync(new URL('./ScreenHost.tsx', import.meta.url), 'utf8');
  assert.match(host, /const inApp = Boolean\(userId\) \|\| guest/);
  assert.equal((host.match(/usesAuthFrame\(screen, inApp\)/g) ?? []).length, 2);
});

test('1.21 X How TaskDrop works is its own full page, never the sign-in frame', () => {
  for (const inApp of [true, false]) assert.equal(usesAuthFrame('intro', inApp), false);
  assert.equal(usesFullPage('intro'), true);
  assert.equal(usesFullPage('signup'), false);
  assert.equal(usesFullPage('home'), false);
});
