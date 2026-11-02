import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS,
  KIND_LABEL,
  STATUS_FILTERS,
  STATUS_LABEL,
  STATUS_TONE,
  compactCount,
  similarQuery,
  withVote,
  withVoteResult,
  type Idea,
} from './ideas.ts';

const idea: Idea = {
  id: 'a',
  title: 'Dark mode',
  body: '',
  category: 'feature',
  status: 'open',
  votes: 4,
  comments: 0,
  iVoted: false,
  mine: false,
  author: 'Ann',
  createdAt: '2026-11-02T00:00:00Z',
  statusChangedAt: '2026-11-02T00:00:00Z',
};

test('a vote adds one, taking it back removes one, and repeating changes nothing', () => {
  const on = withVote(idea, true);
  assert.equal(on.votes, 5);
  assert.equal(on.iVoted, true);
  assert.equal(withVote(on, true), on);
  const off = withVote(on, false);
  assert.equal(off.votes, 4);
  assert.equal(off.iVoted, false);
  assert.equal(withVote({ ...idea, iVoted: true, votes: 0 }, false).votes, 0, 'never below zero');
});

test('the server count wins over the guess', () => {
  const guessed = withVote(idea, true);
  assert.deepEqual(
    { votes: withVoteResult(guessed, { votes: 9, iVoted: true }).votes },
    { votes: 9 },
  );
  assert.equal(withVoteResult(guessed, { votes: 4, iVoted: false }).iVoted, false);
});

test('every status and kind has a label, and the filters only use real statuses', () => {
  for (const s of Object.keys(STATUS_LABEL)) assert.ok(STATUS_TONE[s as keyof typeof STATUS_TONE], s);
  for (const k of KINDS) assert.ok(KIND_LABEL[k], k);
  for (const f of STATUS_FILTERS) assert.ok(f.key === null || f.key in STATUS_LABEL, String(f.key));
  assert.equal(STATUS_FILTERS[0]!.key, null, 'All comes first');
});

test('the similar-idea search takes the longest real word of the title', () => {
  assert.equal(similarQuery('Dark mode for the app'), 'dark');
  assert.equal(similarQuery('Notifications please'), 'notifications');
  assert.equal(similarQuery('add UPI'), null, 'nothing worth searching yet');
  assert.equal(similarQuery(''), null);
});

test('vote counts stay short', () => {
  assert.equal(compactCount(0), '0');
  assert.equal(compactCount(999), '999');
  assert.equal(compactCount(1200), '1.2k');
  assert.equal(compactCount(15000), '15k');
});
