import test from 'node:test';
import assert from 'node:assert/strict';
import { agreedMinor, hireMessage, pctWords, releaseMessage, workerEarnsMinor } from './heldWords.ts';

const rates = { commission: 0.1, posterFee: 0.03 };

test('W3-2: a Rs 100 job held as Rs 103 pays the worker Rs 90', () => {
  assert.equal(agreedMinor(10300, 0.03), 10000);
  assert.equal(workerEarnsMinor(10300, rates), 9000);
  assert.equal(workerEarnsMinor(10300, rates, 10000), 9000);
});

test('the agreed price wins over the sum back-worked from the held figure', () => {
  assert.equal(agreedMinor(12345, 0.03, 12000), 12000);
  assert.equal(agreedMinor(12345, 0.03, null), 11985);
});

test('rates read as whole or tenths of a percent', () => {
  assert.equal(pctWords(0.1), '10%');
  assert.equal(pctWords(0.125), '12.5%');
});

test('W3-1: the release question does not say the whole held amount goes to the worker', () => {
  const m = releaseMessage('Rs 103');
  assert.match(m, /Rs 103 is held/);
  assert.doesNotMatch(m, /goes to the worker/);
  assert.match(m, /less TaskDrop's commission/);
});

test('S4-15: the hire question names the amount, the fee and the cancel fine', () => {
  const m = hireMessage('Rs 100', 'Rs 3', 'Rs 103', { posterFee: 0.03, cancelFine: 0.05 });
  assert.match(m, /^Rs 103 is taken/);
  assert.match(m, /offer Rs 100 plus TaskDrop's 3% service fee \(Rs 3\)/);
  assert.match(m, /5% of the offer goes to the worker/);
});
