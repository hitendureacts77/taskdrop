import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadyMobile, normalizeMobileInput, spacedMobile } from './phone.ts';

/**
 * What the phone box does when text arrives in bursts (P1-2 / W3-9): the box shows the spaced number, the
 * keyboard (or a test tool) appends a chunk of characters to what is shown, and the app keeps only the digits.
 */
function typeBursts(chunks: string[]): string {
  let digits = '';
  for (const chunk of chunks) digits = normalizeMobileInput(spacedMobile(digits) + chunk);
  return digits;
}

test('P1-2: fast typing in bursts keeps every digit in order', () => {
  assert.equal(typeBursts(['9990000001']), '9990000001');
  assert.equal(typeBursts(['999', '00', '0000', '1']), '9990000001');
  assert.equal(typeBursts(['99900', '00001']), '9990000001');
  assert.equal(typeBursts(['9', '99', '000', '00', '01']), '9990000001');
  assert.equal(typeBursts(['98', '765', '4', '3210']), '9876543210');
});

test('P1-2: a number that starts with 91 or 90 survives bursts', () => {
  assert.equal(typeBursts(['91', '234', '56789']), '9123456789');
  assert.equal(typeBursts(['9123456789']), '9123456789');
  assert.equal(typeBursts(['90', '00000', '000']), '9000000000');
});

test('P1-2: a full number ignores extra keys instead of changing digits', () => {
  assert.equal(typeBursts(['9990000001', '5']), '9990000001');
});

test('W3-9: the spaced number reads the same digits back', () => {
  for (const n of ['9990000001', '9990009990', '6000000000', '98765']) {
    assert.equal(spacedMobile(n).replace(/\s/g, ''), n);
    assert.equal(normalizeMobileInput(spacedMobile(n)), n);
  }
});

test('a pasted +91 number keeps its own 10 digits', () => {
  assert.equal(normalizeMobileInput('+919876543210'), '9876543210');
  assert.equal(normalizeMobileInput('+91 98765 43210'), '9876543210');
  assert.equal(normalizeMobileInput('919876543210'), '9876543210');
});

test('W2-8: 0091 is dropped like +91, pasted or typed key by key', () => {
  assert.equal(normalizeMobileInput('0091-9888077001'), '9888077001');
  assert.equal(normalizeMobileInput('0091 98880 77001'), '9888077001');
  let box = '';
  for (const key of '00919888077001') box = normalizeMobileInput(box + key);
  assert.equal(box, '9888077001');
  assert.equal(isReadyMobile(box), true);
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

/** Feeds the text one key at a time, the way a keyboard does (the box keeps only the digits). */
function typeKeys(keys: string): string {
  let box = '';
  for (const ch of keys) box = normalizeMobileInput(box + ch);
  return box;
}

test('typing +91 key by key keeps the person\'s own number (B88)', () => {
  assert.equal(typeKeys('+91 98880 99413'), '9888099413');
  assert.equal(typeKeys('+919888099413'), '9888099413');
  assert.equal(typeKeys('919888099413'), '9888099413');
  assert.equal(typeKeys('09888099413'), '9888099413');
});

test('typing a plain 10-digit number starting 91 key by key is left alone (B88)', () => {
  assert.equal(typeKeys('9123456789'), '9123456789');
  assert.equal(typeKeys('98880 99413'), '9888099413');
});

test('isReadyMobile wants exactly 10 digits starting 6-9', () => {
  assert.equal(isReadyMobile('9876543210'), true);
  assert.equal(isReadyMobile('6000000000'), true);
  assert.equal(isReadyMobile('987654321'), false);
  assert.equal(isReadyMobile('5876543210'), false);
  assert.equal(isReadyMobile('98765432101'), false);
  assert.equal(isReadyMobile(''), false);
});

test('a stray 0 after +91 is dropped (S6-6)', () => {
  assert.equal(normalizeMobileInput('+91 0 98765 43210'), '9876543210');
});
