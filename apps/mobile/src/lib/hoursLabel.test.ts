import test from 'node:test';
import assert from 'node:assert/strict';
import { hoursLabel } from './hoursLabel.ts';

test('one hour is singular', () => {
  assert.equal(hoursLabel(60), '1 hr');
  assert.equal(hoursLabel(89), '1 hr');
});

test('under half an hour still reads as at least 1 hr', () => {
  assert.equal(hoursLabel(0), '1 hr');
  assert.equal(hoursLabel(20), '1 hr');
  assert.equal(hoursLabel(29), '1 hr');
});

test('longer times are plural', () => {
  assert.equal(hoursLabel(90), '2 hrs');
  assert.equal(hoursLabel(120), '2 hrs');
  assert.equal(hoursLabel(1440), '24 hrs');
});

test('a bad value reads as 1 hr', () => {
  assert.equal(hoursLabel(Number.NaN), '1 hr');
});
