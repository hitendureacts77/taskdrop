/**
 * Copy checks for the Staging notice on Terms and Privacy. Run from the repo root:
 *   node --experimental-strip-types --test apps/mobile/src/legal/stagingNotice.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { STAGING_NOTICE } from './stagingNotice.ts';

// docs/LEGAL_AUDIT.md: no claim of compliance, certification or approval anywhere in the legal text.
const CLAIM = /complian|certif|approved|licen[cs]ed|guarantee|secure|safe|GDPR|DPDP|PCI|ISO|SOC/i;

test('the notice says it is staging with fake money and made-up data', () => {
  assert.equal(STAGING_NOTICE.heading, 'Staging');
  for (const text of [STAGING_NOTICE.terms, STAGING_NOTICE.privacy]) {
    assert.match(text, /staging copy of TaskDrop/);
    assert.match(text, /do not enter any real personal information/);
  }
  assert.match(STAGING_NOTICE.terms, /fake/);
  assert.match(STAGING_NOTICE.privacy, /made-up data/);
});

test('the notice makes no compliance claim', () => {
  for (const text of [STAGING_NOTICE.terms, STAGING_NOTICE.privacy]) assert.doesNotMatch(text, CLAIM);
});
