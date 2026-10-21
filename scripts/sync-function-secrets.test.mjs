import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SYNCED, envFileText, pick } from './sync-function-secrets.mjs';

test('only allow-listed names are picked, and blank or missing ones are reported, not sent', () => {
  const { send, missing } = pick({
    INNGEST_EVENT_KEY: ' evt ',
    INNGEST_SIGNING_KEY: '',
    RAZORPAY_KEY_SECRET: 'must-not-travel',
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-travel',
  });
  assert.deepEqual(send, { INNGEST_EVENT_KEY: 'evt' });
  assert.ok(missing.includes('INNGEST_SIGNING_KEY') && missing.includes('IMAGEKIT_PRIVATE_KEY'));
  assert.ok(!('RAZORPAY_KEY_SECRET' in send) && !('SUPABASE_SERVICE_ROLE_KEY' in send));
});

test('a value with a line break is never sent (it would split the env file)', () => {
  assert.deepEqual(pick({ SENTRY_DSN: 'a\nOTHER=b' }).send, {});
});

test('the list never holds a name Supabase refuses for function secrets', () => {
  assert.ok(SYNCED.every((n) => !n.startsWith('SUPABASE_')));
});

test('the env file is one NAME=value per line', () => {
  assert.equal(envFileText({ A: '1', B: '2' }), 'A=1\nB=2\n');
});
