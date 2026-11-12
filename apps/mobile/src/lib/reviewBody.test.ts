import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewBody, praiseAllowed } from './reviewBody.ts';

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
