import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeInto, typingDisplay, wholeDigits, wholeText } from './rupeeInput.ts';

test('P1-6: a typed price keeps its rupee sign, and typing it back through the box gives the same amount', () => {
  assert.equal(typingDisplay(''), '');
  assert.equal(typingDisplay('50'), '₹50');
  assert.equal(typingDisplay('250.'), '₹250.');
  // L1-9: lakh grouping while typing, and typing it back gives the same amount.
  assert.equal(typingDisplay('100000'), '₹1,00,000');
  assert.equal(wholeDigits(typingDisplay('100000')), '100000');
  assert.equal(wholeText(typingDisplay('100000') + '0', 10), '1000000');
  // The box shows "₹5"; the next key makes "₹50"; the amount kept is still the plain digits.
  assert.equal(wholeText(typingDisplay('5') + '0'), '50');
  assert.equal(wholeText(typingDisplay(wholeText('₹50')).slice(0, -1)), '5');
  assert.equal(wholeText('₹'), '');
});

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

test('B167 recheck: typing key by key into a controlled box keeps the point, so paise never join the rupees', () => {
  // The first fix only handled a pasted "250.50"; typed one key at a time it still became 25050.
  assert.equal(typeInto('250.50', (t) => wholeDigits(t)), '25050');
  assert.equal(typeInto('250.50', (t) => wholeText(t)), '250.');
  assert.equal(wholeDigits(typeInto('250.50', (t) => wholeText(t))), '250');
  assert.equal(typeInto('2.5', (t) => wholeText(t, 3)), '2.');
  assert.equal(typeInto('1234567.9', (t) => wholeText(t, 7)), '1234567.');
});

test('a point with no rupees before it is not kept', () => {
  assert.equal(wholeText('.5'), '');
  assert.equal(wholeText('₹1,500.'), '1500.');
});
