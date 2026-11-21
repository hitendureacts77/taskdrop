import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoalText } from './goalText.ts';

test('W3-15: a minus sign is refused, not dropped', () => {
  const r = parseGoalText('-5');
  assert.equal(r.ok, false);
});

test('W3-15: plain amounts, with the commas and the rupee sign people type, are saved in paise', () => {
  assert.deepEqual(parseGoalText('2000'), { ok: true, minor: 200000 });
  assert.deepEqual(parseGoalText(' ₹ 2,500 '), { ok: true, minor: 250000 });
  assert.deepEqual(parseGoalText('250.50'), { ok: true, minor: 25000 });
});

test('W3-15: empty clears the goal; zero and words are refused', () => {
  assert.deepEqual(parseGoalText('   '), { ok: true, minor: null });
  assert.equal(parseGoalText('0').ok, false);
  assert.equal(parseGoalText('abc').ok, false);
  assert.equal(parseGoalText('12abc').ok, false);
});

test('W3-15: more than the most is refused with the limit named', () => {
  const r = parseGoalText('9999999');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /₹10,00,000/);
});
