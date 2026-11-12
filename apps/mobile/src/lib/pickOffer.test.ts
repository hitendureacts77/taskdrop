import test from 'node:test';
import assert from 'node:assert/strict';
import { offerKey, pickOffer } from './pickOffer.ts';

const rows = [
  { bidId: 'b1', who: 'Ravi', priceMinor: 100 },
  { bidId: 'b2', who: 'Ravi', priceMinor: 300 },
  { bidId: 'b3', who: 'Asha', priceMinor: 200 },
];

test('two offers with the same name are told apart by bid id', () => {
  assert.equal(pickOffer(rows, 'b2')?.priceMinor, 300);
  assert.equal(pickOffer(rows, 'b1')?.priceMinor, 100);
});

test('nothing picked, or a pick no longer listed, falls back to the first row', () => {
  assert.equal(pickOffer(rows, null)?.bidId, 'b1');
  assert.equal(pickOffer(rows, 'gone')?.bidId, 'b1');
});

test('sample rows without a bid id are matched by name', () => {
  const sample = [{ who: 'A' }, { who: 'B' }];
  assert.equal(offerKey(sample[1]), 'B');
  assert.equal(pickOffer(sample, 'B')?.who, 'B');
});

test('an empty list picks nothing', () => {
  assert.equal(pickOffer([], 'b1'), undefined);
});
