import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskSchema, createBidSchema, reviewSchema, taskMediaSchema } from './index.ts';

test('createTaskSchema accepts a valid task', () => {
  const r = createTaskSchema.safeParse({
    pillar: 'services',
    title: 'Fix my leaking tap',
    benchmarkMinor: 50_000,
    timeLimitMinutes: 120,
  });
  assert.equal(r.success, true);
});

test('createTaskSchema rejects a missing time limit', () => {
  const r = createTaskSchema.safeParse({
    pillar: 'services',
    title: 'No time limit given',
    benchmarkMinor: 50_000,
  });
  assert.equal(r.success, false);
});

test('createTaskSchema rejects a negative price', () => {
  const r = createTaskSchema.safeParse({
    pillar: 'procurement',
    title: 'Bad price',
    benchmarkMinor: -1,
    timeLimitMinutes: 60,
  });
  assert.equal(r.success, false);
});

test('taskMediaSchema requires duration for video and caps at 60s', () => {
  assert.equal(taskMediaSchema.safeParse({ kind: 'video', storagePath: 'x' }).success, false);
  assert.equal(
    taskMediaSchema.safeParse({ kind: 'video', storagePath: 'x', durationSeconds: 45 }).success,
    true,
  );
  assert.equal(
    taskMediaSchema.safeParse({ kind: 'video', storagePath: 'x', durationSeconds: 61 }).success,
    false,
  );
});

test('createBidSchema requires a uuid task id', () => {
  assert.equal(
    createBidSchema.safeParse({ taskId: 'not-a-uuid', priceMinor: 100, timeLimitMinutes: 30 })
      .success,
    false,
  );
});

test('reviewSchema enforces a 1–5 rating', () => {
  const base = { taskId: '00000000-0000-0000-0000-000000000000', aboutRole: 'worker' as const };
  assert.equal(reviewSchema.safeParse({ ...base, rating: 5 }).success, true);
  assert.equal(reviewSchema.safeParse({ ...base, rating: 6 }).success, false);
  assert.equal(reviewSchema.safeParse({ ...base, rating: 0 }).success, false);
});
