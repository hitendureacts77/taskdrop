import test from 'node:test';
import assert from 'node:assert/strict';
import {
  posterEscrowCharge,
  workerNetPayout,
  platformRevenue,
  postStartCancelFine,
  clearAt,
  autoCompleteAt,
} from './index.ts';

// All amounts in minor units (paise). ₹1000 = 100000.
const RS_1000 = 100_000;

test('poster escrow charge adds the 3% service fee', () => {
  assert.equal(posterEscrowCharge(RS_1000), 103_000);
});

test('worker net payout deducts the 20% commission', () => {
  assert.equal(workerNetPayout(RS_1000), 80_000);
});

test('platform revenue = 20% commission + 3% poster fee', () => {
  assert.equal(platformRevenue(RS_1000), 23_000);
});

test('post-start cancel fine is 5% of the locked value', () => {
  assert.equal(postStartCancelFine(RS_1000), 5_000);
});

test('rounding stays integer for odd amounts', () => {
  // ₹333.33 -> 33333 paise; 20% = 6666.6 -> 6667 (rounded), net 26666
  assert.equal(workerNetPayout(33_333), 26_666);
  assert.equal(Number.isInteger(workerNetPayout(33_333)), true);
});

test('clearAt adds exactly 7 days', () => {
  const completed = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(clearAt(completed).toISOString(), '2026-01-08T00:00:00.000Z');
});

test('autoCompleteAt adds exactly 3 days', () => {
  const workDone = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(autoCompleteAt(workDone).toISOString(), '2026-01-04T00:00:00.000Z');
});
