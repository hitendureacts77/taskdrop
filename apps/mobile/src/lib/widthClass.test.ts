// node --experimental-strip-types --test apps/mobile/src/lib/widthClass.test.ts
// Task 1.14 level 1: the native width rule. Phones (under 600) and the web never change.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isNativeWide, nativeColumns, nativeContentWidth, TABLET_CONTENT } from './widthClass.ts';

test('every phone width stays the phone layout on a native app', () => {
  for (const w of [320, 360, 390, 412, 432, 599]) assert.equal(isNativeWide(false, w), false, String(w));
});

test('a native screen 600 or wider is a wide one (tablet, opened foldable, split-screen)', () => {
  for (const w of [600, 673, 768, 840, 1024, 1280]) assert.equal(isNativeWide(false, w), true, String(w));
});

test('the web never takes the native wide path, at any width', () => {
  for (const w of [320, 600, 768, 1024, 1440, 1920]) assert.equal(isNativeWide(true, w), false, String(w));
});

test('wide content is held to 720 and feeds are two columns once it is 640', () => {
  assert.equal(nativeContentWidth(600), 600);
  assert.equal(nativeContentWidth(1280), TABLET_CONTENT);
  assert.equal(nativeColumns(600), 1);
  assert.equal(nativeColumns(640), 2);
  assert.equal(nativeColumns(1280), 2);
});
