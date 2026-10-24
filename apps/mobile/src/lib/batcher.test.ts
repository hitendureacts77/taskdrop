import test from 'node:test';
import assert from 'node:assert/strict';
import { Batcher, type Args, type Reply } from './batcher.ts';

class Refusal extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.code = code;
  }
}

/** A batcher whose server is a function we control; `log` records what actually went over the wire. */
function rig(opts: { send?: (calls: { op: string; args: Args }[]) => Promise<Reply[]>; max?: number } = {}) {
  const log: string[] = [];
  const batcher = new Batcher({
    windowMs: 5,
    max: opts.max,
    batchable: new Set(['a', 'b', 'c']),
    send: async (calls) => {
      log.push('batch:' + calls.map((c) => c.op).join(','));
      return opts.send ? opts.send(calls) : calls.map((c) => ({ ok: true, data: c.op + '!' }) as Reply);
    },
    single: async (op) => {
      log.push('single:' + op);
      return op + '?';
    },
    refuse: (e) => new Refusal(e.message, e.code ?? null),
  });
  return { batcher, log };
}

test('calls made together travel as one request, each with its own answer', async () => {
  const { batcher, log } = rig();
  const [a, b, c] = await Promise.all([batcher.call('a'), batcher.call('b', { x: 1 }), batcher.call('c')]);
  assert.deepEqual([a, b, c], ['a!', 'b!', 'c!']);
  assert.deepEqual(log, ['batch:a,b,c']);
});

test('a lone call goes out alone, exactly as before', async () => {
  const { batcher, log } = rig();
  assert.equal(await batcher.call('a'), 'a?');
  assert.deepEqual(log, ['single:a']);
});

test('a call that is not a read never joins a batch', async () => {
  const { batcher, log } = rig();
  const [a, w, b] = await Promise.all([batcher.call('a'), batcher.call('placeBid'), batcher.call('b')]);
  assert.deepEqual([a, w, b], ['a!', 'placeBid?', 'b!']);
  assert.deepEqual(log.sort(), ['batch:a,b', 'single:placeBid']);
});

test('a refused call fails alone; the rest of the batch still answers', async () => {
  const { batcher } = rig({
    send: async () => [
      { ok: true, data: 1 },
      { ok: false, error: { message: 'Not for you', code: 'FORBIDDEN' } },
    ],
  });
  const [ok, bad] = await Promise.allSettled([batcher.call('a'), batcher.call('b')]);
  assert.equal(ok.status === 'fulfilled' && ok.value, 1);
  assert.ok(bad.status === 'rejected' && bad.reason instanceof Refusal && bad.reason.code === 'FORBIDDEN');
});

test('when the request itself fails, every call in it fails the same way', async () => {
  const boom = new Refusal('offline', 'NETWORK');
  const { batcher } = rig({ send: async () => Promise.reject(boom) });
  const results = await Promise.allSettled([batcher.call('a'), batcher.call('b')]);
  assert.ok(results.every((r) => r.status === 'rejected' && r.reason === boom));
});

test('a server that cannot batch is asked one call at a time, then never batched again', async () => {
  const { batcher, log } = rig({ send: async () => Promise.reject(new Refusal('Unknown request', 'UNKNOWN_OP')) });
  assert.deepEqual(await Promise.all([batcher.call('a'), batcher.call('b')]), ['a?', 'b?']);
  assert.deepEqual(await Promise.all([batcher.call('a'), batcher.call('c')]), ['a?', 'c?']);
  assert.deepEqual(log, ['batch:a,b', 'single:a', 'single:b', 'single:a', 'single:c']);
});

test('a reply that does not line up with its calls is not guessed at', async () => {
  const { batcher, log } = rig({ send: async () => [{ ok: true, data: 'only one' }] });
  assert.deepEqual(await Promise.all([batcher.call('a'), batcher.call('b')]), ['a?', 'b?']);
  assert.deepEqual(log, ['batch:a,b', 'single:a', 'single:b']);
});

test('a full batch leaves at once, and the overflow starts the next one', async () => {
  const { batcher, log } = rig({ max: 2 });
  const out = await Promise.all([batcher.call('a'), batcher.call('b'), batcher.call('c')]);
  assert.deepEqual(out, ['a!', 'b!', 'c?']);
  assert.deepEqual(log, ['batch:a,b', 'single:c']);
});
