import assert from 'node:assert/strict';
import test from 'node:test';
import {
  locationAskedThisLaunch,
  markLocationAsked,
  shouldAskForLocation,
  type LiveStatus,
} from './locationAsk.ts';

const shouldOpen = (status: LiveStatus, askedThisLaunch = false, lookingElsewhere = false) =>
  shouldAskForLocation({ status, askedThisLaunch, lookingElsewhere });

test('asks when location is not granted', () => {
  for (const s of ['denied', 'blocked', 'services-off', 'prompt'] as const) {
    assert.equal(shouldOpen(s), true, s);
  }
});

test('never asks while checking, idle, granted or errored', () => {
  for (const s of ['idle', 'checking', 'granted', 'error'] as const) {
    assert.equal(shouldOpen(s), false, s);
  }
});

test('not twice in one launch, and not while looking at another place', () => {
  assert.equal(shouldOpen('prompt', true), false);
  assert.equal(shouldOpen('prompt', false, true), false);
});

test('the launch flag sticks once marked', () => {
  assert.equal(locationAskedThisLaunch(), false);
  markLocationAsked();
  assert.equal(locationAskedThisLaunch(), true);
});
