import test from 'node:test';
import assert from 'node:assert/strict';
import { canTopUp, nextTopUpSteps, raisedPriceMinor } from './topUp.ts';

test('only bigger top-up steps are offered, and none at the top step', () => {
  assert.deepEqual(nextTopUpSteps(0), [2, 3, 5, 10, 15, 20, 25]);
  assert.deepEqual(nextTopUpSteps(null), [2, 3, 5, 10, 15, 20, 25]);
  assert.deepEqual(nextTopUpSteps(10), [15, 20, 25]);
  assert.deepEqual(nextTopUpSteps(25), []);
});

test('the new offer is worked out from the price before any top-up, rounded to the rupee', () => {
  // ₹1,000 with no top-up, raised to 10% → ₹1,100.
  assert.equal(raisedPriceMinor(100000, 0, 10), 110000);
  // ₹1,100 that already had 10% (base ₹1,000), raised to 20% → ₹1,200, not ₹1,320.
  assert.equal(raisedPriceMinor(110000, 10, 20), 120000);
  // Rounding: ₹333 + 5% = ₹349.65 → ₹350.
  assert.equal(raisedPriceMinor(33300, 0, 5), 35000);
});

test('the offer never goes down, even when an old price was rounded up', () => {
  assert.ok(raisedPriceMinor(35000, 5, 5) >= 35000);
});

test('only an open request below the top step can be topped up', () => {
  assert.equal(canTopUp({ status: 'OPEN', kind: 'request', topup_pct: 0 }), true);
  assert.equal(canTopUp({ status: 'OPEN', kind: 'request', topup_pct: 25 }), false);
  assert.equal(canTopUp({ status: 'OPEN', kind: 'service', topup_pct: 0 }), false);
  assert.equal(canTopUp({ status: 'LOCKED', kind: 'request', topup_pct: 0 }), false);
});
