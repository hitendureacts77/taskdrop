/**
 * Copy checks for the dispute policy (plan task 4.9). Run from the repo root:
 *   node --experimental-strip-types --test apps/mobile/src/legal/disputePolicy.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DISPUTE_ACK_HOURS,
  DISPUTE_DECIDE_WORKING_DAYS,
  DISPUTE_POLICY,
  NOT_ALLOWED,
  NOT_ALLOWED_LINE,
  REPORT_SUBTITLE,
  SAFETY_CARD,
} from './disputePolicy.ts';

const all = [
  ...DISPUTE_POLICY.map((x) => x.text),
  ...NOT_ALLOWED,
  ...SAFETY_CARD,
  NOT_ALLOWED_LINE,
  REPORT_SUBTITLE,
].join('\n');

test('the policy says the payment stays held and the outcome is one side or the other', () => {
  assert.match(all, /payment stays held/);
  assert.match(all, /The money is not split/);
  assert.match(all, /the worker is paid/);
  assert.match(all, /poster gets back everything/);
});

test('the time limits are the owner’s defaults and appear in the text', () => {
  assert.equal(DISPUTE_ACK_HOURS, 24);
  assert.equal(DISPUTE_DECIDE_WORKING_DAYS, 3);
  assert.match(all, /within 24 hours/);
  assert.match(all, /within 3 working days/);
});

test('no sentence claims a legal or regulatory status (AGENTS.md: do not claim compliance)', () => {
  assert.doesNotMatch(all, /complian|certif|approved|licen[cs]ed|guarantee|GDPR|DPDP|PCI|ISO|SOC/i);
});

test('the safety card has four lines and no feature that was rejected on 1 November', () => {
  assert.equal(SAFETY_CARD.length, 4);
  assert.doesNotMatch(all, /live track|safety shield|start code|track your|share your location/i);
});

test('the not-allowed list covers the owner’s items', () => {
  const list = NOT_ALLOWED.join(' ');
  for (const word of ['illegal', 'weapons', 'medicines', 'adult', 'cash', 'under 18', 'outside']) {
    assert.match(list, new RegExp(word, 'i'));
  }
});
