import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wholeDigits } from './rupeeInput.ts';

test('B167: paise are dropped, not glued onto the rupees', () => {
  assert.equal(wholeDigits('250.50'), '250');
  assert.equal(wholeDigits('₹1,500.75'), '1500');
  assert.equal(wholeDigits('2.5'), '2');
  assert.equal(wholeDigits('-5.5e3'), '5');
});

test('commas, spaces and the rupee sign are ignored', () => {
  assert.equal(wholeDigits('₹ 1,00,000'), '100000');
  assert.equal(wholeDigits('abc'), '');
  assert.equal(wholeDigits('.50'), '');
});

test('the length cap applies to the whole rupees', () => {
  assert.equal(wholeDigits('12345678.90', 7), '1234567');
});
