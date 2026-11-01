import test from 'node:test';
import assert from 'node:assert/strict';
import { STREAK_GOAL, badgesFor, daysLeftInWeek, goalProgress } from './streaks.ts';

const none = {
  weekStart: '2026-10-26T18:30:00.000Z',
  weekEarnedMinor: 0,
  weekJobs: 0,
  weeklyGoalMinor: null,
  onTimeStreak: 0,
  jobsDone: 0,
  earlyStarts: 0,
  fiveStars: 0,
  crewJobs: 0,
  liveAnswers: 0,
  photoJobs: 0,
};

test('a new helper has no badges, and each says what is left', () => {
  const b = badgesFor(none);
  assert.equal(b.filter((x) => x.earned).length, 0);
  assert.equal(b.find((x) => x.key === 'ten')!.hint, '10 more jobs');
  assert.equal(b.find((x) => x.key === 'early')!.hint, '1 more early start');
});

test('badges unlock at their counts', () => {
  const b = badgesFor({ ...none, jobsDone: 12, onTimeStreak: STREAK_GOAL, earlyStarts: 2, fiveStars: 4 });
  const earned = b.filter((x) => x.earned).map((x) => x.key);
  assert.deepEqual(earned, ['early', 'ten', 'ontime']);
  assert.equal(b.find((x) => x.key === 'five')!.hint, '1 more 5-star review');
});

test('the weekly goal: share and what is left, nothing without a goal', () => {
  assert.equal(goalProgress(none), null);
  assert.deepEqual(goalProgress({ weekEarnedMinor: 345000, weeklyGoalMinor: 500000 }), { share: 0.69, toGoMinor: 155000 });
  assert.deepEqual(goalProgress({ weekEarnedMinor: 600000, weeklyGoalMinor: 500000 }), { share: 1, toGoMinor: 0 });
});

test('days left in the week', () => {
  assert.equal(daysLeftInWeek('2026-10-26T18:30:00.000Z', new Date('2026-10-31T12:00:00.000Z')), 3);
  assert.equal(daysLeftInWeek('2026-10-26T18:30:00.000Z', new Date('2026-11-03T12:00:00.000Z')), 0);
});
