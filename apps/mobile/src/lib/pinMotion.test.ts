import test from 'node:test';
import assert from 'node:assert/strict';
import { RING_R0, RING_R1, RING_SCALE0, epochLive, ringAt, rippleDelay, rippleRanks } from './mapMotion.ts';
import { MAX_FRESH, RIPPLE_EVERY_MS } from './mapMotion.ts';

test('the ring grows from 20 to 50 px and fades out', () => {
  assert.equal(RING_SCALE0 * RING_R1, RING_R0);
  assert.equal(ringAt(0).scale, RING_SCALE0);
  assert.equal(ringAt(1).scale, 1);
  assert.equal(ringAt(1).opacity, 0);
  assert.ok(ringAt(0.5).opacity < ringAt(0).opacity);
  assert.equal(ringAt(2).scale, 1);
});

test('fresh pins take turns and never exceed MAX_FRESH', () => {
  const r = rippleRanks([true, false, true, true, true]);
  assert.deepEqual(r, [0, null, 1, null, null]);
  assert.equal(r.filter((x) => x !== null).length, MAX_FRESH);
  assert.equal(rippleDelay(0), 0);
  assert.ok(rippleDelay(1) > 0 && rippleDelay(5) < RIPPLE_EVERY_MS);
});

test('an epoch is live until its end, never under reduced motion', () => {
  assert.equal(epochLive(100, 200, false), true);
  assert.equal(epochLive(200, 200, false), false);
  assert.equal(epochLive(100, 200, true), false);
});
