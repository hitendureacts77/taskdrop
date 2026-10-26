/**
 * Tests for when the staging screens show. Run from the repo root:
 *   node --experimental-strip-types --test apps/mobile/src/lib/environment.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseEnvironment,
  shouldShowStagingCard,
  showStagingUi,
  STAGING_CARD,
  STAGING_REPORT_EMAIL,
  STAGING_RIBBON,
} from './environment.ts';

test('only "production" is production: a missing, odd or old value stays staging', () => {
  assert.equal(parseEnvironment('production'), 'production');
  for (const v of [undefined, null, '', 'staging', 'alpha', 'Production', 'prod', 1, true, {}]) {
    assert.equal(parseEnvironment(v), 'staging');
  }
});

test('the ribbon and the staging screens show in staging and when the field is missing, never in production', () => {
  assert.equal(showStagingUi(parseEnvironment('staging')), true);
  assert.equal(showStagingUi(parseEnvironment(undefined)), true);
  assert.equal(showStagingUi(parseEnvironment('production')), false);
});

const base = { environment: 'staging', signedIn: true, screen: 'home', seen: false } as const;

test('the tester card opens once: staging, signed in, a main screen, not seen yet', () => {
  assert.equal(shouldShowStagingCard(base), true);
  assert.equal(shouldShowStagingCard({ ...base, environment: 'production' }), false);
  assert.equal(shouldShowStagingCard({ ...base, signedIn: false }), false);
  assert.equal(shouldShowStagingCard({ ...base, seen: true }), false);
  assert.equal(shouldShowStagingCard({ ...base, seen: null }), false, 'still reading the device: show nothing');
});

test('the tester card waits until sign-in and set-up screens are behind the person', () => {
  for (const screen of ['splash', 'welcome', 'signup', 'setup', 'terms', 'privacy']) {
    assert.equal(shouldShowStagingCard({ ...base, screen }), false, screen);
  }
  for (const screen of ['home', 'wallet', 'explore']) assert.equal(shouldShowStagingCard({ ...base, screen }), true, screen);
});

test('the ribbon says what the plan says, and the card is not local-only', () => {
  assert.equal(STAGING_RIBBON, 'Staging: fake money and fake data');
  const all = [STAGING_CARD.intro, ...STAGING_CARD.points, STAGING_CARD.reportBefore, STAGING_CARD.reportAfter].join(' ');
  assert.match(STAGING_CARD.intro, /Ask for anything\. Someone gets it done for you\./);
  assert.match(STAGING_CARD.intro, /in person nearby or online from anywhere/);
  assert.doesNotMatch(all, /local only|only local|nearby only|only nearby/i);
  assert.deepEqual(STAGING_CARD.test, ['Post a task', 'Send an offer', 'Pay', 'Do the work', 'Approve', 'Review', 'Withdraw']);
  assert.equal(STAGING_REPORT_EMAIL, 'hitendureacts@gmail.com');
});
