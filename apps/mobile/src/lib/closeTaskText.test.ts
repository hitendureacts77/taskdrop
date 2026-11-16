import test from 'node:test';
import assert from 'node:assert/strict';
import { closeTaskText, hireFineNote } from './closeTaskText.ts';

const money = (m: number) => `₹${(m / 100).toFixed(m % 100 ? 2 : 0)}`;
const base = { title: 'GST invoice', funded: true, fineMinor: 4750, finePct: 5, money };

test('W2-3: once work has started the dialog names the 5% fine', () => {
  for (const status of ['TASK_STARTED', 'OVERDUE']) {
    const r = closeTaskText({ ...base, status });
    assert.match(r.message, /5% of the price/);
    assert.match(r.message, /₹47\.50/);
    assert.doesNotMatch(r.message, /Everything you paid/);
    assert.match(r.sub, /5% fine/);
  }
});

test('before work starts everything comes back', () => {
  const r = closeTaskText({ ...base, status: 'LOCKED' });
  assert.match(r.message, /Everything you paid, service fee included/);
  assert.doesNotMatch(r.message, /fine/);
});

test('an unpaid post is only taken down', () => {
  const r = closeTaskText({ ...base, funded: false, status: 'OPEN' });
  assert.match(r.message, /taken down/);
  assert.doesNotMatch(r.sub, /comes back/);
});

test('W3-6: the hire note names the fine in rupees and says it applies only once work has started', () => {
  const n = hireFineNote({ fineMinor: 500, finePct: 5, money });
  assert.match(n, /before the worker starts, all of it comes back/);
  assert.match(n, /Once they have started/);
  assert.match(n, /5% fine \(₹5 on this offer\)/);
});

test('W3-6: with no fine to name the note is only the free-cancel line', () => {
  const n = hireFineNote({ fineMinor: 0, finePct: 5, money });
  assert.doesNotMatch(n, /fine/);
});
