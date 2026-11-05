import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRODUCTION_ONLY,
  STAGING_ONLY,
  STAGING_PROJECT,
  allowList,
  envFileText,
  isForbiddenName,
  parseEnv,
  parseNames,
  pick,
  resolveProject,
} from './set-function-secrets.mjs';

test('only allow-listed names are picked, and blank or missing ones are reported, not sent', () => {
  const { send, missing } = pick({
    INNGEST_EVENT_KEY: ' evt ',
    INNGEST_SIGNING_KEY: '',
    RAZORPAY_KEY_SECRET: 'must-not-travel',
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-travel',
    LOGIN_VERCEL_PASSWORD: 'must-not-travel',
    KEYSTORE_PASSWORD: 'must-not-travel',
  });
  assert.deepEqual(send, { INNGEST_EVENT_KEY: 'evt' });
  assert.ok(missing.includes('INNGEST_SIGNING_KEY') && missing.includes('IMAGEKIT_PRIVATE_KEY'));
  for (const n of ['RAZORPAY_KEY_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'LOGIN_VERCEL_PASSWORD', 'KEYSTORE_PASSWORD']) {
    assert.ok(!(n in send), n);
  }
});

test('a value with a line break is never sent (it would split the env file)', () => {
  assert.deepEqual(pick({ SENTRY_DSN: 'a\nOTHER=b' }).send, {});
});

test('no list ever holds a name Supabase refuses, or a login, recovery, keystore or PROD_ name', () => {
  for (const production of [false, true]) {
    assert.ok(allowList(production).every((n) => !isForbiddenName(n)));
  }
  assert.ok(isForbiddenName('SUPABASE_URL') && isForbiddenName('PROD_SENTRY_DSN'));
  assert.ok(isForbiddenName('LOGIN_GITHUB_EMAIL') && isForbiddenName('RECOVERY_GOOGLE_1') && isForbiddenName('KEYSTORE_PASSWORD'));
});

test('staging reads plain names only and never a PROD_ name', () => {
  const { send } = pick({ SENTRY_DSN: 'stage', PROD_SENTRY_DSN: 'prod' });
  assert.deepEqual(send, { SENTRY_DSN: 'stage' });
  assert.deepEqual(pick({ PROD_SENTRY_DSN: 'prod' }).send, {});
});

test('production reads PROD_ names only, and never the staging plain name', () => {
  assert.deepEqual(pick({ SENTRY_DSN: 'stage', PROD_SENTRY_DSN: 'prod' }, { production: true }).send, { SENTRY_DSN: 'prod' });
  assert.deepEqual(pick({ SENTRY_DSN: 'stage' }, { production: true }).send, {});
});

test('staging-only test shortcuts never reach production; real SMS keys never reach staging', () => {
  assert.ok(STAGING_ONLY.includes('ALLOW_ANY_OTP'));
  const prod = pick({ PROD_ALLOW_ANY_OTP: 'yes', PROD_TEST_PHONES: '1', PROD_MSG91_AUTHKEY: 'k' }, { production: true }).send;
  assert.deepEqual(prod, { MSG91_AUTHKEY: 'k' });
  const stage = pick({ ALLOW_ANY_OTP: 'yes', MSG91_AUTHKEY: 'k', MSG91_TEMPLATE_ID: 't' }).send;
  assert.deepEqual(stage, { ALLOW_ANY_OTP: 'yes' });
  assert.ok(PRODUCTION_ONLY.every((n) => !allowList(false).includes(n)));
});

test('Razorpay and the gateway secret are not in either list (they live in Vault or one function secret)', () => {
  for (const production of [false, true]) {
    assert.ok(allowList(production).every((n) => !/^RAZORPAY|^API_GATEWAY_SECRET/.test(n)));
  }
});

test('names Supabase already holds are skipped, not sent and not reported missing', () => {
  const r = pick({ INNGEST_EVENT_KEY: 'a', INNGEST_SIGNING_KEY: 'b' }, { skip: ['INNGEST_EVENT_KEY'] });
  assert.deepEqual(r.send, { INNGEST_SIGNING_KEY: 'b' });
  assert.deepEqual(r.skipped.includes('INNGEST_EVENT_KEY'), true);
  assert.ok(!r.missing.includes('INNGEST_EVENT_KEY'));
});

test('production needs its own project, and never the staging one', () => {
  assert.deepEqual(resolveProject({}, false), { ok: true, ref: STAGING_PROJECT });
  assert.equal(resolveProject({}, true).ok, false);
  assert.equal(resolveProject({ PROD_SUPABASE_PROJECT_ID: STAGING_PROJECT }, true).ok, false);
  assert.equal(resolveProject({ PROD_SUPABASE_PROJECT_ID: 'x; rm -rf /' }, true).ok, false);
  assert.deepEqual(resolveProject({ PROD_SUPABASE_PROJECT_ID: 'abcdefghij0123456789' }, true), { ok: true, ref: 'abcdefghij0123456789' });
});

test('the master file is parsed: comments, export, quotes, and values holding = or #', () => {
  const f = parseEnv('# heading\nA=1\nexport B="two words"\nC=\'x\'\nD=a=b#c\n\nnot a line\nE=\n');
  assert.deepEqual(f, { A: '1', B: 'two words', C: 'x', D: 'a=b#c', E: '' });
});

test('the env file is one NAME="value" per line, with quotes and backslashes escaped', () => {
  assert.equal(envFileText({ A: '1', B: 'x #y' }), 'A="1"\nB="x #y"\n');
  assert.equal(envFileText({ C: 'a"b\\c' }), 'C="a\\"b\\\\c"\n');
});

test('secret names are read from the CLI list as JSON or as a table, without digests', () => {
  assert.deepEqual(parseNames('[{"name":"A_ONE","value":"abc123"},{"name":"B"}]'), ['A_ONE', 'B']);
  assert.deepEqual(parseNames('   NAME      |  DIGEST \n  ---------|------\n  A_ONE    | ab12\n  B_TWO | cd34\n'), ['A_ONE', 'B_TWO']);
});
