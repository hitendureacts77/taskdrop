import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampHours,
  hoursText,
  initialTiming,
  messageWithoutTiming,
  offerTimingLine,
  stepHours,
  timingFields,
  timingFromOffer,
} from './offerTiming.ts';

const NOW = Date.parse('2026-11-26T10:00:00Z');
const DUE = '2026-11-26T12:30:00Z';
const fmt = (d: Date) => d.toISOString().slice(0, 16);

test('hours read as hours or whole days', () => {
  assert.equal(hoursText(1), '1 hour');
  assert.equal(hoursText(3), '3 hours');
  assert.equal(hoursText(24), '1 day');
  assert.equal(hoursText(168), '7 days');
});

test('the stepper stays inside 1 hour to 7 days', () => {
  assert.equal(stepHours(3, 1), 4);
  assert.equal(stepHours(12, 1), 24);
  assert.equal(stepHours(168, 1), 168);
  assert.equal(stepHours(1, -1), 1);
  assert.equal(stepHours(24, -1), 12);
  // An in-between value from an older offer moves to the next step.
  assert.equal(stepHours(7, 1), 8);
  assert.equal(stepHours(7, -1), 6);
  assert.equal(clampHours(500), 168);
  assert.equal(clampHours(0), 3);
});

test('a no-date task starts on "By a date", a dated one on "That works"', () => {
  assert.equal(initialTiming(true).mode, 'date');
  assert.equal(initialTiming(false).mode, 'keep');
});

test('what each choice sends', () => {
  const t = initialTiming(true);
  const later = new Date(NOW + 86_400_000);
  assert.deepEqual(timingFields({ ...t, finishBy: later }, null, NOW), { proposedDueAt: later.toISOString(), timeLimitMinutes: null, lines: [] });
  assert.deepEqual(timingFields(t, null, NOW), { proposedDueAt: null, timeLimitMinutes: null, lines: [] });
  assert.deepEqual(timingFields({ ...t, finishBy: new Date(NOW - 3_600_000) }, null, NOW), { error: 'Pick a finish time from now on' });
  assert.deepEqual(timingFields({ ...t, mode: 'hours', hours: 3 }, null, NOW), {
    proposedDueAt: null,
    timeLimitMinutes: 180,
    lines: ['Estimated time: 3 hours'],
  });
  assert.deepEqual(timingFields({ ...t, mode: 'keep' }, DUE, NOW), { proposedDueAt: null, timeLimitMinutes: null, lines: [] });
});

test('asking for more time needs a date after the customer’s date', () => {
  const t = { ...initialTiming(false), mode: 'more' as const };
  assert.deepEqual(timingFields(t, DUE, NOW), { error: 'Pick the date you can finish by' });
  assert.deepEqual(timingFields({ ...t, finishBy: new Date(DUE) }, DUE, NOW), { error: 'Pick a date after the customer’s date' });
  const later = new Date(Date.parse(DUE) + 86_400_000);
  assert.deepEqual(timingFields({ ...t, finishBy: later, reason: '  Paint   needs a day ' }, DUE, NOW), {
    proposedDueAt: later.toISOString(),
    timeLimitMinutes: null,
    lines: ['Why more time: Paint needs a day'],
  });
});

test('an earlier offer opens with its timing', () => {
  const at = '2026-11-28T06:30:00Z';
  assert.equal(timingFromOffer({ proposed_due_at: at }, true).mode, 'date');
  const more = timingFromOffer({ proposed_due_at: at, message: 'Hi\nWhy more time: Paint dries' }, false);
  assert.equal(more.mode, 'more');
  assert.equal(more.reason, 'Paint dries');
  const hrs = timingFromOffer({ message: 'Hi\nEstimated time: 5 hours' }, true);
  assert.equal(hrs.mode, 'hours');
  assert.equal(hrs.hours, 5);
  assert.equal(timingFromOffer({ message: 'Hi' }, false).mode, 'keep');
});

test('the customer reads the timing in plain words', () => {
  const at = '2026-11-28T06:30:00Z';
  assert.deepEqual(offerTimingLine({ proposed_due_at: at }, null, fmt), { kind: 'by', text: 'Can finish by 2026-11-28T06:30' });
  assert.deepEqual(offerTimingLine({ message: 'Hi\nEstimated time: 3 hours' }, null, fmt), { kind: 'hours', text: 'Can finish in 3 hours' });
  assert.deepEqual(offerTimingLine({ message: 'Hi\nWhy more time: Paint dries', proposed_due_at: at }, DUE, fmt), {
    kind: 'more',
    text: 'Asks for more time: 2026-11-28T06:30',
    yours: 'Your date: 2026-11-26T12:30',
    reason: 'Paint dries',
  });
  // An earlier date than the customer's is not a request for more time.
  assert.deepEqual(offerTimingLine({ proposed_due_at: '2026-11-26T11:00:00Z' }, DUE, fmt), { kind: 'by', text: 'Can finish by 2026-11-26T11:00' });
  // Hours on a dated task are only an estimate: no line.
  assert.equal(offerTimingLine({ message: 'Estimated time: 3 hours' }, DUE, fmt), null);
  assert.equal(offerTimingLine({}, null, fmt), null);
});

test('timing lines come out of the shown message', () => {
  assert.equal(messageWithoutTiming('I paint well\nEstimated time: 3 hours\nWhy more time: Paint dries'), 'I paint well');
  assert.equal(messageWithoutTiming(null), '');
});
