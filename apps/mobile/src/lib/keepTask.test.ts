import test from 'node:test';
import assert from 'node:assert/strict';
import { keepTaskBody, keepTaskOptions } from './keepTask.ts';

const money = (m: number) => `₹${m / 100}`;
const open = { status: 'OPEN', kind: 'request', topup_pct: 0, benchmark_minor: 100000 };

test('an open request gets top up, share and post again, with the new price named', () => {
  const o = keepTaskOptions(open, false, money);
  assert.deepEqual(o.map((x) => x.id), ['topup', 'share', 'similar']);
  assert.match(o[0].sub, /^Workers see ₹\d+\. You pay only when you accept an offer\.$/);
});

test('no top up once it is at the top step or for a listing', () => {
  assert.ok(!keepTaskOptions({ ...open, topup_pct: 25 }, false, money).some((x) => x.id === 'topup'));
  assert.ok(!keepTaskOptions({ ...open, kind: 'service' }, false, money).some((x) => x.id === 'topup'));
});

test('a task with a worker offers a message and no open-task options', () => {
  const o = keepTaskOptions({ ...open, status: 'LOCKED' }, true, money);
  assert.deepEqual(o.map((x) => x.id), ['message']);
});

test('a worker-less non-open task has no options', () => {
  assert.deepEqual(keepTaskOptions({ ...open, status: 'LOCKED' }, false, money), []);
});

test('body words follow the status', () => {
  assert.match(keepTaskBody('OPEN'), /may not have seen it/);
  assert.match(keepTaskBody('LOCKED'), /worker is lined up/);
});
