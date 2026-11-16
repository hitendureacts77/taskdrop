import test from 'node:test';
import assert from 'node:assert/strict';
import { completeByDate, paymentLine, showAssignmentChip, datePassedLine, successPercent } from './taskStatusText.ts';

test('complete-by uses the target date first (B153)', () => {
  const d = completeByDate({ due_at: '2026-11-16T01:34:00Z', created_at: '2026-11-10T03:54:00Z', time_limit_minutes: 2880 });
  assert.equal(d?.toISOString(), '2026-11-16T01:34:00.000Z');
});

test('B153 / W2-6: with no target date there is no complete-by date (never created + time limit)', () => {
  assert.equal(completeByDate({ due_at: null, created_at: '2026-11-10T00:00:00Z', time_limit_minutes: 60 }), null);
  assert.equal(completeByDate({ created_at: '2026-11-10T00:00:00Z', time_limit_minutes: 60 }), null);
});

test('payment line says paid once finished (B155)', () => {
  assert.equal(paymentLine({ status: 'AUTO_COMPLETED', funded_at: 'x' }, true, '₹5,047'), '₹5,047 paid');
  assert.equal(paymentLine({ status: 'COMPLETED', funded_at: 'x' }, true, '₹5,047'), '₹5,047 paid');
  assert.equal(paymentLine({ status: 'TASK_STARTED', funded_at: 'x' }, true, '₹950'), '₹950 held');
  assert.equal(paymentLine({ status: 'CANCELLED', funded_at: 'x' }, true, '₹950'), '₹950 refunded');
  assert.equal(paymentLine({ status: 'LOCKED', funded_at: null }, true, '₹950'), '₹950 due');
  assert.equal(paymentLine({ status: 'OPEN', funded_at: null }, false, '₹0'), 'Paid when you accept an offer');
});

test('assignment chip only while open (B158)', () => {
  assert.equal(showAssignmentChip('OPEN'), true);
  assert.equal(showAssignmentChip('COMPLETED'), false);
  assert.equal(showAssignmentChip('TASK_STARTED'), false);
});

test('"No one picked it" only for an open task with no offers (B154)', () => {
  assert.equal(datePassedLine('OPEN', 0), 'THE DATE HAS PASSED · NO ONE PICKED IT');
  assert.equal(datePassedLine('OVERDUE', 0), 'THE DATE HAS PASSED');
  assert.equal(datePassedLine('OPEN', 3), 'THE DATE HAS PASSED');
});

test('success ignores offers still waiting (B159)', () => {
  assert.equal(successPercent(6, 1, 5), '100%');
  assert.equal(successPercent(6, 1, 0), '17%');
  assert.equal(successPercent(5, 0, 5), '–');
  assert.equal(successPercent(0, 0, 0), '–');
});
