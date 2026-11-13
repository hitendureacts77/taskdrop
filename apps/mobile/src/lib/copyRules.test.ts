import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('B94: the sign-in headline does not say tasks are local only', () => {
  const src = read('../screens/AccessScreen.tsx');
  assert.ok(!src.includes(String.raw`Get help nearby.\nOr earn nearby.`), 'old local-only headline is still there');
  assert.ok(src.includes(String.raw`Get help, near or far.\nOr earn.`), 'new headline missing');
});

test('B94: the referral share text does not say earn nearby', () => {
  assert.ok(!read('../screens/WalletScreen.tsx').includes('and earn nearby'));
});
