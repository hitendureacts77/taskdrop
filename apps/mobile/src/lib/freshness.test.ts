import test from 'node:test';
import assert from 'node:assert/strict';
import { FRESH_FOR_MS, isFresh, noteChange, reuseWhileFresh, stamp } from './freshness.ts';

test('a read stays fresh for a while, then goes stale', () => {
  const s = stamp(1_000);
  assert.equal(isFresh(s, 1_000), true);
  assert.equal(isFresh(s, 1_000 + FRESH_FOR_MS - 1), true);
  assert.equal(isFresh(s, 1_000 + FRESH_FOR_MS), false);
  assert.equal(isFresh(null, 1_000), false);
  // A clock that went backwards proves nothing.
  assert.equal(isFresh(s, 999), false);
});

test('any change makes every earlier read stale at once', () => {
  const s = stamp(5_000);
  noteChange();
  assert.equal(isFresh(s, 5_001), false);
  assert.equal(isFresh(stamp(5_001), 5_002), true);
});

test('a fresh answer is reused, a stale or changed one is asked again', async () => {
  let asked = 0;
  const ask = async () => ++asked;
  assert.equal(await reuseWhileFresh('count', ask, 10_000), 1);
  assert.equal(await reuseWhileFresh('count', ask, 10_000 + 1_000), 1);
  assert.equal(await reuseWhileFresh('other', ask, 10_000 + 1_000), 2);
  assert.equal(await reuseWhileFresh('count', ask, 10_000 + FRESH_FOR_MS), 3);
  noteChange();
  assert.equal(await reuseWhileFresh('count', ask, 10_000 + FRESH_FOR_MS + 1), 4);
});

test('a failed answer is not kept', async () => {
  let asked = 0;
  const ask = async () => {
    asked += 1;
    if (asked === 1) throw new Error('offline');
    return asked;
  };
  await assert.rejects(reuseWhileFresh('flaky', ask, 50_000));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await reuseWhileFresh('flaky', ask, 50_001), 2);
});
