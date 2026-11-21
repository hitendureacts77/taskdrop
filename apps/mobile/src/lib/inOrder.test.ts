import test from 'node:test';
import assert from 'node:assert/strict';
import { inOrder } from './inOrder.ts';

test('P1-9: calls run one after another, so a read never lands inside a write', async () => {
  const run = inOrder();
  const log: string[] = [];
  const slow = (name: string, ms: number) => () =>
    new Promise<void>((resolve) => {
      log.push(`${name} start`);
      setTimeout(() => {
        log.push(`${name} end`);
        resolve();
      }, ms);
    });
  await Promise.all([run(slow('write', 20)), run(slow('read', 1))]);
  assert.deepEqual(log, ['write start', 'write end', 'read start', 'read end']);
});

test('P1-9: the queue keeps going after a call fails', async () => {
  const run = inOrder();
  await assert.rejects(
    run(async () => {
      throw new Error('x');
    }),
    /x/,
  );
  assert.equal(await run(async () => 5), 5);
});
