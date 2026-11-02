import test from 'node:test';
import assert from 'node:assert/strict';
import { RepeatKeys, outcomeUnknown, stableJson } from './repeatKeys.ts';

/** Keys k1, k2, ... and a clock the test moves by hand. */
function setup(keepMs = 10 * 60_000, max = 20) {
  let n = 0;
  let now = 1_000_000;
  const keys = new RepeatKeys(() => `k${++n}`, keepMs, () => now, max);
  return { keys, later: (ms: number) => (now += ms) };
}

const PAY = { taskId: 'task-1' };

test('each new tap gets a new key once the last one had a clear answer', () => {
  const { keys } = setup();
  const first = keys.take('payTaskFromWallet', PAY);
  keys.settle('payTaskFromWallet', PAY, first, false);
  const second = keys.take('payTaskFromWallet', PAY);
  assert.notEqual(first, second);
});

test('a double tap while the first is on its way shares its key, so the server does it once', () => {
  const { keys } = setup();
  const first = keys.take('payTaskFromWallet', PAY);
  assert.equal(keys.take('payTaskFromWallet', PAY), first);
  // Different arguments or a different write are different requests.
  assert.notEqual(keys.take('payTaskFromWallet', { taskId: 'task-2' }), first);
  assert.notEqual(keys.take('startTask', PAY), first);
});

test('after a lost answer the same tap reuses the key for 10 minutes, then starts afresh', () => {
  const { keys, later } = setup();
  const first = keys.take('requestWithdrawal', { amountMinor: 50000 });
  keys.settle('requestWithdrawal', { amountMinor: 50000 }, first, true);
  later(9 * 60_000);
  assert.equal(keys.take('requestWithdrawal', { amountMinor: 50000 }), first);
  keys.settle('requestWithdrawal', { amountMinor: 50000 }, first, true);
  later(11 * 60_000);
  assert.notEqual(keys.take('requestWithdrawal', { amountMinor: 50000 }), first);
});

test('field order does not make a different request', () => {
  const { keys } = setup();
  const first = keys.take('lockBid', { bidId: 'b', payoutMode: 'one_time' });
  assert.equal(keys.take('lockBid', { payoutMode: 'one_time', bidId: 'b' }), first);
  assert.equal(stableJson({ b: 1, a: { d: [1, undefined], c: undefined } }), '{"a":{"d":[1,null]},"b":1}');
});

test('settling an old key never ends a newer one', () => {
  const { keys, later } = setup(1000);
  const old = keys.take('startTask', PAY);
  later(2000);
  const fresh = keys.take('startTask', PAY);
  keys.settle('startTask', PAY, old, false);
  assert.equal(keys.take('startTask', PAY), fresh);
});

test('only a few keys are remembered', () => {
  const { keys } = setup(10 * 60_000, 2);
  const a = keys.take('sendMessage', { body: 'a' });
  keys.take('sendMessage', { body: 'b' });
  keys.take('sendMessage', { body: 'c' });
  assert.notEqual(keys.take('sendMessage', { body: 'a' }), a, 'the oldest was forgotten');
});

test('the outcome is unknown with no answer, a gateway page, or "still going through"', () => {
  assert.equal(outcomeUnknown(null), false);
  assert.equal(outcomeUnknown({ network: true }), true);
  assert.equal(outcomeUnknown({ status: 503 }), true);
  assert.equal(outcomeUnknown({ status: 500 }), true);
  assert.equal(outcomeUnknown({ status: 409, ours: true }), true);
  // The server answered: too fast, signed out, or a rule said no. The outcome is known.
  assert.equal(outcomeUnknown({ status: 429, ours: true }), false);
  assert.equal(outcomeUnknown({ status: 401, ours: true }), false);
  assert.equal(outcomeUnknown({ status: 422, ours: true }), false);
});
