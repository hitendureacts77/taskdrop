import assert from 'node:assert/strict';
import test from 'node:test';
import {
  locationAskedThisLaunch,
  markLocationAsked,
  shouldAskForLocation,
  dismissedRecently,
  DISMISS_FOR_MS,
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

test('a recent "Not now" keeps the sheet shut, an old one does not', () => {
  const now = 1_700_000_000_000;
  assert.equal(dismissedRecently(null, now), false);
  assert.equal(dismissedRecently(now - 60_000, now), true);
  assert.equal(dismissedRecently(now - DISMISS_FOR_MS - 1, now), false);
  assert.equal(dismissedRecently(now + 60_000, now), false, 'a clock set wrong must not hide it forever');
  assert.equal(dismissedRecently(Number.NaN, now), false);
  assert.equal(shouldAskForLocation({ status: 'blocked', askedThisLaunch: false, lookingElsewhere: false, dismissedRecently: true }), false);
  assert.equal(shouldAskForLocation({ status: 'blocked', askedThisLaunch: false, lookingElsewhere: false, dismissedRecently: false }), true);
});
