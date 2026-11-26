import test from 'node:test';
import assert from 'node:assert/strict';
import { myTasksLine, myWorkLine, walletLine, mapLine } from './tabLines.ts';

test('my tasks: need-you part only when something needs the poster', () => {
  assert.equal(myTasksLine({ loaded: true, need: 2, active: 5, done: 7 }), '2 need you · 5 active · 7 done');
  assert.equal(myTasksLine({ loaded: true, need: 0, active: 0, done: 0 }), '0 active · 0 done');
  assert.equal(myTasksLine({ loaded: false, need: 0, active: 0, done: 0 }), 'Loading…');
});

test('my work: success shows only when there is one', () => {
  assert.equal(myWorkLine({ earned: '₹18,400', done: 12, active: 1, success: '96%' }), '₹18,400 earned · 12 done · 1 active · 96%');
  assert.equal(myWorkLine({ earned: '₹0', done: 0, active: 0, success: '–' }), '₹0 earned · 0 done · 0 active');
  assert.equal(myWorkLine({ earned: null, done: null, active: null, success: '–' }), 'Loading…');
});

test('wallet: held money, with available when given', () => {
  assert.equal(walletLine({ loaded: true, held: '₹3,700', heldMinor: 370000 }), '₹3,700 held safely');
  assert.equal(walletLine({ loaded: true, held: '₹0', heldMinor: 0 }), 'Nothing held right now');
  assert.equal(walletLine({ loaded: true, held: '₹10', heldMinor: 1000, available: '₹50' }), '₹50 available · ₹10 held safely');
  assert.equal(walletLine({ loaded: false, held: '', heldMinor: 0 }), 'Loading…');
});

test('map line joins count words and place', () => {
  assert.equal(mapLine('18 helpers', 'Kondapur', ' · within 5 km'), '18 helpers · Kondapur · within 5 km');
  assert.equal(mapLine('18 helpers', ''), '18 helpers');
});
