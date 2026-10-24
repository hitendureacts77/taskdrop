import test from 'node:test';
import assert from 'node:assert/strict';
import { RETRY_DELAYS_MS, isTransient, retryWhile } from './retry.ts';

const noSleep = async () => {};

test('a gateway or startup blip is worth asking again; our own answer and other statuses are not', () => {
  assert.equal(isTransient({ status: 503 }), true);
  assert.equal(isTransient({ status: 502 }), true);
  assert.equal(isTransient({ status: 504 }), true);
  assert.equal(isTransient({ network: true }), true);
  // The server decided (too many requests, signed out, a rule said no): asking again changes nothing.
  assert.equal(isTransient({ status: 429, ours: true }), false);
  assert.equal(isTransient({ status: 503, ours: true }), false);
  assert.equal(isTransient({ status: 401 }), false);
  assert.equal(isTransient({ status: 500 }), false);
  assert.equal(isTransient({}), false);
});

test('a read that works first time is asked once', async () => {
  let calls = 0;
  const out = await retryWhile(async () => (++calls, 'ok'), () => false, RETRY_DELAYS_MS, noSleep);
  assert.equal(out, 'ok');
  assert.equal(calls, 1);
});

test('a blip is asked again and the later answer wins', async () => {
  const answers = ['blip', 'blip', 'ok'];
  let calls = 0;
  const waits: number[] = [];
  const out = await retryWhile(
    async () => answers[calls++]!,
    (r) => r === 'blip',
    RETRY_DELAYS_MS,
    async (ms) => void waits.push(ms),
  );
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [400, 1000]);
});

test('it gives up after two repeats and returns the last failure', async () => {
  let calls = 0;
  const out = await retryWhile(async () => `try ${++calls}`, () => true, RETRY_DELAYS_MS, noSleep);
  assert.equal(calls, 3);
  assert.equal(out, 'try 3');
});

test('a failure that is not a blip is not repeated', async () => {
  let calls = 0;
  const out = await retryWhile(async () => (++calls, 'refused'), (r) => r === 'blip', RETRY_DELAYS_MS, noSleep);
  assert.equal(out, 'refused');
  assert.equal(calls, 1);
});

test('no delays means no repeats (what a write gets)', async () => {
  let calls = 0;
  await retryWhile(async () => ++calls, () => true, [], noSleep);
  assert.equal(calls, 1);
});
