import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewBody, praiseAllowed, canSubmitReview } from './reviewBody.ts';

test('B76 / W2-4: a review needs a star picked first (it starts at none)', () => {
  assert.equal(canSubmitReview(0), false);
  for (const n of [1, 2, 3, 4, 5]) assert.equal(canSubmitReview(n), true);
  assert.equal(canSubmitReview(6), false);
  assert.equal(canSubmitReview(2.5), false);
});

test('praise tags are kept on a 4 or 5 star review', () => {
  assert.equal(reviewBody(5, ['On time'], 'Lovely'), 'Lovely\nOn time');
  assert.equal(reviewBody(4, ['On time', 'Fair price'], ''), 'On time · Fair price');
});

test('praise tags are dropped at 3 stars or fewer', () => {
  for (const s of [1, 2, 3]) {
    assert.equal(reviewBody(s, ['On time', 'Great communication'], 'Late and rude'), 'Late and rude');
    assert.equal(reviewBody(s, ['On time'], ''), '');
    assert.equal(praiseAllowed(s), false);
  }
});

test('the comment is trimmed and no tags means just the comment', () => {
  assert.equal(reviewBody(5, [], '  fine  '), 'fine');
});
