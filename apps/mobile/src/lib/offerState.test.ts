import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFER_COPY, isDuplicateOfferError, offerState } from './offerState.ts';
import type { OfferInput } from './offerState.ts';

const base: OfferInput = { isOwn: false, isHunt: false, taskOpen: true, bid: null };
const sent = { is_locked: false };
const accepted = { is_locked: true };

test('own request wins over everything', () => {
  assert.equal(offerState({ ...base, isOwn: true }), 'own');
  assert.equal(offerState({ ...base, isOwn: true, isHunt: true, bid: accepted }), 'own');
  assert.equal(offerState({ ...base, isOwn: true, taskOpen: false }), 'own');
});

test('a Hunt takes finds, not offers, ahead of any offer state', () => {
  assert.equal(offerState({ ...base, isHunt: true }), 'hunt');
  assert.equal(offerState({ ...base, isHunt: true, bid: sent }), 'hunt');
  assert.equal(offerState({ ...base, isHunt: true, bid: accepted, taskOpen: false }), 'hunt');
});

test('a locked (accepted) offer is "accepted", open or not', () => {
  assert.equal(offerState({ ...base, bid: accepted }), 'accepted');
  assert.equal(offerState({ ...base, bid: accepted, taskOpen: false }), 'accepted');
});

test('a sent offer on an open task can be edited', () => {
  assert.equal(offerState({ ...base, bid: sent }), 'edit');
});

test('a sent offer on a task that is no longer open is closed', () => {
  assert.equal(offerState({ ...base, bid: sent, taskOpen: false }), 'closed');
});

test('no offer: send while open, closed otherwise', () => {
  assert.equal(offerState(base), 'send');
  assert.equal(offerState({ ...base, taskOpen: false }), 'closed');
});

test('copy: every state has a note; only send, edit, closed and hunt have a button', () => {
  for (const state of ['send', 'edit', 'accepted', 'closed', 'own', 'hunt'] as const) {
    assert.ok(OFFER_COPY[state].note.length > 0, state);
  }
  assert.equal(OFFER_COPY.send.button, 'Send offer');
  assert.equal(OFFER_COPY.edit.button, 'Edit your offer');
  assert.equal(OFFER_COPY.closed.button, 'Find another request');
  assert.match(OFFER_COPY.hunt.button ?? '', /looking/);
  assert.equal(OFFER_COPY.accepted.button, null);
  assert.equal(OFFER_COPY.own.button, null);
});

test('copy says "offer", never quote or bid', () => {
  for (const { button, note } of Object.values(OFFER_COPY)) {
    assert.doesNotMatch(`${button ?? ''} ${note}`, /\b(quote|quotes|quoted|bid|bids)\b/i);
  }
});

test('isDuplicateOfferError: the DUPLICATE code', () => {
  assert.equal(isDuplicateOfferError({ code: 'DUPLICATE' }), true);
  assert.equal(isDuplicateOfferError(Object.assign(new Error('x'), { code: 'DUPLICATE' })), true);
});

test('isDuplicateOfferError: the message wording', () => {
  assert.equal(isDuplicateOfferError(new Error('You have already sent an offer for this task.')), true);
  assert.equal(isDuplicateOfferError({ message: 'duplicate key value violates unique constraint' }), true);
  assert.equal(isDuplicateOfferError({ message: 'bids_task_id_worker_id_key is not unique' }), true);
});

test('isDuplicateOfferError: false for everything else', () => {
  assert.equal(isDuplicateOfferError(new Error('Network request failed')), false);
  assert.equal(isDuplicateOfferError({ code: 'CLOSED', message: 'This task is no longer taking offers' }), false);
  assert.equal(isDuplicateOfferError({ code: 'RATE_LIMITED' }), false);
  assert.equal(isDuplicateOfferError('already sent an offer'), false);
  assert.equal(isDuplicateOfferError(null), false);
  assert.equal(isDuplicateOfferError(undefined), false);
  assert.equal(isDuplicateOfferError(42), false);
});
