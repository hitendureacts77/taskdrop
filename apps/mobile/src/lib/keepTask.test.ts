import test from 'node:test';
import assert from 'node:assert/strict';
import { keepTaskBody, keepTaskOptions } from './keepTask.ts';

const money = (m: number) => `₹${m / 100}`;
const open = { status: 'OPEN' };

test('an open request gets top up, share and post again, with the new price named', () => {
  const o = keepTaskOptions(open, false, money, 110000);
  assert.deepEqual(o.map((x) => x.id), ['topup', 'share', 'similar']);
  assert.equal(o[0].sub, 'Workers see ₹1100. You pay only when you accept an offer.');
});

test('no top up when the task cannot be topped up', () => {
  assert.deepEqual(keepTaskOptions(open, false, money, null).map((x) => x.id), ['share', 'similar']);
});

test('a task with a worker offers a message and no open-task options', () => {
  assert.deepEqual(keepTaskOptions({ status: 'LOCKED' }, true, money, 110000).map((x) => x.id), ['message']);
});

test('a worker-less non-open task has no options', () => {
  assert.deepEqual(keepTaskOptions({ status: 'LOCKED' }, false, money, null), []);
});

test('body words follow the status', () => {
  assert.match(keepTaskBody('OPEN'), /may not have seen it/);
  assert.match(keepTaskBody('LOCKED'), /worker is lined up/);
});
