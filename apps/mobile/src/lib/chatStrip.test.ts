import test from 'node:test';
import assert from 'node:assert/strict';
import { chatMoneyLine } from './chatStrip';

const held = { amount: 'Rs 500', earns: 'Rs 450' };

test('held money is described as held while the work is on', () => {
  assert.equal(chatMoneyLine('TASK_STARTED', held, true), 'Rs 500 · held safely');
  assert.equal(chatMoneyLine('TASK_STARTED', held, false), 'You earn Rs 450 · held safely');
});
test('a finished or cancelled task no longer says held', () => {
  assert.equal(chatMoneyLine('COMPLETED', held, true), 'Rs 500 released to the worker');
  assert.equal(chatMoneyLine('AUTO_COMPLETED', held, false), 'Rs 450 released to you');
  assert.equal(chatMoneyLine('CANCELLED', held, true), 'This task was cancelled');
});
test('no figure never claims a payment is held', () => {
  assert.equal(chatMoneyLine('LOCKED', null, true), 'Open the task for payment details');
});
