import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_CHIPS, firstJobsChip, firstOf, livePillText, openNearText, shownJobsChip } from './homeJobs.ts';

test('decision 5: a worker with no skills opens on Near you, with skills on For you', () => {
  assert.equal(firstJobsChip([]), 'near');
  assert.equal(firstJobsChip(null), 'near');
  assert.equal(firstJobsChip(undefined), 'near');
  assert.equal(firstJobsChip(['  ', '']), 'near');
  assert.equal(firstJobsChip(['Photo & Video']), 'you');
  assert.equal(firstJobsChip(['', 'Errands']), 'you');
});

test('a tapped chip wins over the first choice, and skills arriving late move an untouched list', () => {
  assert.equal(shownJobsChip(null, []), 'near');
  assert.equal(shownJobsChip(null, ['Tutoring']), 'you');
  assert.equal(shownJobsChip('remote', ['Tutoring']), 'remote');
  assert.equal(shownJobsChip('near', ['Tutoring']), 'near');
});

test('the four chips, in the drawn order', () => {
  assert.deepEqual(
    JOB_CHIPS.map((c) => c.label),
    ['For you', 'Near you', 'Remote', 'Today'],
  );
});

test('the live pill counts helpers first, then tasks done, and never shows a fake 0', () => {
  assert.equal(livePillText({ activeNow: 12, doneToday: 34 }), '12 helpers active now');
  assert.equal(livePillText({ activeNow: 1, doneToday: 0 }), '1 helper active now');
  assert.equal(livePillText({ activeNow: 0, doneToday: 5 }), '5 done near you today');
  assert.equal(livePillText({ activeNow: 0, doneToday: 0 }), 'Live near you');
  assert.equal(livePillText(null), 'Live near you');
});

test('Earn pill: a count, capped at the read limit', () => {
  assert.equal(openNearText(null, 30), null);
  assert.equal(openNearText(0, 30), 'No jobs near you yet');
  assert.equal(openNearText(23, 30), '23 open near you');
  assert.equal(openNearText(30, 30), '30+ open near you');
});

test('firstOf keeps every row reachable behind Show more', () => {
  const rows = [1, 2, 3, 4, 5];
  assert.deepEqual(firstOf(rows, 2, false), { shown: [1, 2], extra: 3 });
  assert.deepEqual(firstOf(rows, 2, true), { shown: rows, extra: 3 });
  assert.deepEqual(firstOf([1, 2], 4, false), { shown: [1, 2], extra: 0 });
});
