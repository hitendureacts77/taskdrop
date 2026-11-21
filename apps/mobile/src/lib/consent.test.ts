// node --experimental-strip-types --test apps/mobile/src/lib/consent.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONSENT_KEY,
  analyticsAllowed,
  currentConsent,
  parseConsent,
  readConsent,
  resetConsentForTests,
  subscribeConsent,
  writeConsent,
} from './consent.ts';

function fakeStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const blocked = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

test('parse accepts only the v1 shape', () => {
  assert.deepEqual(parseConsent('{"analytics":true,"at":"2026-11-17T00:00:00.000Z","v":1}'), {
    analytics: true,
    at: '2026-11-17T00:00:00.000Z',
    v: 1,
  });
  for (const bad of [null, undefined, '', 'nope', '{}', '{"analytics":"yes","v":1}', '{"analytics":true,"v":2}', 'null', '5']) {
    assert.equal(parseConsent(bad as string | null), null, String(bad));
  }
});

test('nothing stored means no choice and no analytics', () => {
  resetConsentForTests();
  const s = fakeStore();
  assert.equal(readConsent(s), null);
  assert.equal(analyticsAllowed(s), false);
});

test('write saves under the key, remembers it and notifies listeners', () => {
  resetConsentForTests();
  const s = fakeStore();
  const seen: boolean[] = [];
  const stop = subscribeConsent((c) => seen.push(c?.analytics === true));
  const c = writeConsent(true, s, new Date('2026-11-17T10:00:00Z'));
  assert.equal(c.at, '2026-11-17T10:00:00.000Z');
  assert.deepEqual(JSON.parse(s.data[CONSENT_KEY]), c);
  assert.equal(analyticsAllowed(s), true);
  writeConsent(false, s);
  assert.equal(analyticsAllowed(s), false);
  stop();
  writeConsent(true, s);
  assert.deepEqual(seen, [true, false]);
});

test('a stored choice is read back after a reload', () => {
  resetConsentForTests();
  const s = fakeStore({ [CONSENT_KEY]: '{"analytics":true,"at":"x","v":1}' });
  assert.equal(analyticsAllowed(s), true);
});

test('blocked storage never throws and counts as essential only', () => {
  resetConsentForTests();
  assert.equal(readConsent(blocked), null);
  assert.equal(analyticsAllowed(blocked), false);
  assert.doesNotThrow(() => writeConsent(true, blocked));
  // Held in memory for this visit.
  assert.equal(currentConsent(blocked)?.analytics, true);
  resetConsentForTests();
});

test('a throwing listener does not stop the others', () => {
  resetConsentForTests();
  let ok = false;
  subscribeConsent(() => {
    throw new Error('boom');
  });
  subscribeConsent(() => {
    ok = true;
  });
  writeConsent(false, fakeStore());
  assert.equal(ok, true);
  resetConsentForTests();
});
