import test from 'node:test';
import assert from 'node:assert/strict';
import { isPendingWithdrawal, withdrawalRows } from './walletPending.ts';

const row = (id: string, kind: string, title: string, at: string) => ({ id, kind, title, at });

test('requested withdrawals are pending, finished ones are not', () => {
  assert.equal(isPendingWithdrawal(row('1', 'payout', 'Withdrawal requested', '2026-10-05')), true);
  assert.equal(isPendingWithdrawal(row('2', 'payout', 'Withdrawal request via UPI', '2026-10-05')), true);
  assert.equal(isPendingWithdrawal(row('3', 'payout', 'Sent to your bank', '2026-10-05')), false);
  assert.equal(isPendingWithdrawal(row('4', 'payout', 'Transfer on its way', '2026-10-05')), false);
  assert.equal(isPendingWithdrawal(row('5', 'payout', 'Withdrawal cancelled', '2026-10-05')), false);
  assert.equal(isPendingWithdrawal(row('6', 'clearing', 'Withdrawal requested', '2026-10-05')), false);
});

test('an old pending withdrawal still shows when the period excludes it, once', () => {
  const old = row('o', 'payout', 'Withdrawal requested', '2026-10-05');
  const oldPaid = row('p', 'payout', 'Sent to your bank', '2026-09-01');
  const recent = row('r', 'payout', 'Sent to your bank', '2026-11-08');
  const earning = row('e', 'clearing', 'Task done', '2026-11-09');
  const all = [recent, earning, old, oldPaid];
  const inPeriod = [recent, earning];
  assert.deepEqual(withdrawalRows(all, inPeriod).map((r) => r.id), ['r', 'o']);
  // Already in the period: not doubled.
  assert.deepEqual(withdrawalRows(all, all).map((r) => r.id), ['r', 'o', 'p']);
});
