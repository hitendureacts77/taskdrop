import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadyMobile, normalizeMobileInput } from './phone.ts';

test('a pasted +91 number keeps its own 10 digits', () => {
  assert.equal(normalizeMobileInput('+919876543210'), '9876543210');
  assert.equal(normalizeMobileInput('+91 98765 43210'), '9876543210');
  assert.equal(normalizeMobileInput('919876543210'), '9876543210');
});

test('a leading 0 is dropped', () => {
  assert.equal(normalizeMobileInput('09876543210'), '9876543210');
});

test('spaces and dashes are ignored', () => {
  assert.equal(normalizeMobileInput('98765 43210'), '9876543210');
  assert.equal(normalizeMobileInput('98765-43210'), '9876543210');
});

test('a 10-digit number starting with 91 is not stripped', () => {
  assert.equal(normalizeMobileInput('9123456789'), '9123456789');
});

test('typing digit by digit never loses digits', () => {
  assert.equal(normalizeMobileInput('9'), '9');
  assert.equal(normalizeMobileInput('91'), '91');
  assert.equal(normalizeMobileInput('98765'), '98765');
});

test('extra digits are capped at 10', () => {
  assert.equal(normalizeMobileInput('98765432101234'), '9876543210');
  assert.equal(normalizeMobileInput(''), '');
});

test('isReadyMobile wants exactly 10 digits starting 6-9', () => {
  assert.equal(isReadyMobile('9876543210'), true);
  assert.equal(isReadyMobile('6000000000'), true);
  assert.equal(isReadyMobile('987654321'), false);
  assert.equal(isReadyMobile('5876543210'), false);
  assert.equal(isReadyMobile('98765432101'), false);
  assert.equal(isReadyMobile(''), false);
});
