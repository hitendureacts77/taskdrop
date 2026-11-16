import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PRICE_INR, MIN_PRICE_INR, priceNote, priceState } from './limits.ts';

test('B90: an amount is empty, low, ok or over the most', () => {
  assert.equal(MAX_PRICE_INR, 100_000);
  assert.equal(priceState(null), 'empty');
  assert.equal(priceState(0), 'empty');
  assert.equal(priceState(MIN_PRICE_INR - 1), 'low');
  assert.equal(priceState(MIN_PRICE_INR), 'ok');
  assert.equal(priceState(MAX_PRICE_INR), 'ok');
  assert.equal(priceState(MAX_PRICE_INR + 1), 'high');
  assert.equal(priceState(9_99_99_99_999), 'high');
});

test('W3-11: an offer outside the limits gets the post flow plain messages, in Indian grouping', () => {
  assert.equal(priceNote(null), 'The lowest price is ₹20');
  assert.equal(priceNote(0), 'The lowest price is ₹20');
  assert.equal(priceNote(MIN_PRICE_INR - 1), 'The lowest price is ₹20');
  assert.equal(priceNote(99_999_999), 'The most is ₹1,00,000');
  assert.equal(priceNote(MIN_PRICE_INR), null);
  assert.equal(priceNote(MAX_PRICE_INR), null);
});
