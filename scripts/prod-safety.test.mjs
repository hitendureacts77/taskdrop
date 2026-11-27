/**
 * Production connection gate and safety checks (plan task 5.9). No connection anywhere: fixtures only.
 *   node --experimental-strip-types --test scripts/prod-safety.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FORBIDDEN_IN_PRODUCTION } from '../supabase/functions/_shared/safetyAlarm.ts';
import {
  LOCAL_OVERRIDE_NAME, LOCAL_OVERRIDE_VALUE, PRODUCTION_PROJECT, TEST_PROJECT, productionAllowed, productionUrl, projectRefOf, targetKind,
  withDb,
} from './lib/db.mjs';
import {
  EXPECTED_SETTINGS, FORBIDDEN_SECRET_NAMES, alarmLine, criticalOf, expectedVerifyJwt, judgeDatabase, judgePlatform, parseDsn,
  sendToSentry, sentryEnvelope,
} from './lib/prod-safety.mjs';
import { allowList } from './set-function-secrets.mjs';

// Throwaway passwords; never a real one.
const prodPooler = `postgresql://postgres.${PRODUCTION_PROJECT}:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
const prodDirect = `postgresql://postgres:pw@db.${PRODUCTION_PROJECT}.supabase.co:5432/postgres`;
const stagingPooler = `postgresql://postgres.${TEST_PROJECT}:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CI = { PRODUCTION_DEPLOY: '1', GITHUB_ACTIONS: 'true' };

// ------------------------------------------------------------- the gate --

test('production is refused without the flag, as before', () => {
  assert.equal(targetKind(prodPooler, {}), null);
  assert.equal(targetKind(prodDirect, { GITHUB_ACTIONS: 'true' }), null);
  assert.equal(targetKind(prodPooler, { PRODUCTION_DEPLOY: 'true', GITHUB_ACTIONS: 'true' }), null); // only exactly "1"
  assert.equal(targetKind(stagingPooler, {}), 'test');
  assert.equal(targetKind(local, {}), 'local');
});

test('the flag alone is not enough: it must run in GitHub Actions or carry the written override', () => {
  assert.equal(targetKind(prodPooler, { PRODUCTION_DEPLOY: '1' }), null);
  assert.equal(targetKind(prodPooler, { PRODUCTION_DEPLOY: '1', [LOCAL_OVERRIDE_NAME]: 'yes' }), null);
  assert.equal(targetKind(prodPooler, { PRODUCTION_DEPLOY: '1', [LOCAL_OVERRIDE_NAME]: LOCAL_OVERRIDE_VALUE }), 'production');
  assert.equal(productionAllowed(CI), true);
});

test('with the flag, only the production ref is accepted', () => {
  assert.equal(targetKind(prodPooler, CI), 'production');
  assert.equal(targetKind(prodDirect, CI), 'production');
  // a wrong ref
  assert.equal(targetKind('postgresql://postgres.abcdefghij0123456789:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres', CI), null);
  // the staging address with the production flag: refused, never "deployed" to staging
  assert.equal(targetKind(stagingPooler, CI), null);
  assert.equal(targetKind(`postgresql://postgres:pw@db.${TEST_PROJECT}.supabase.co:5432/postgres`, CI), null);
  // localhost with the production flag: refused too
  assert.equal(targetKind(local, CI), null);
  // look-alikes
  assert.equal(targetKind(`postgresql://postgres:pw@db.${PRODUCTION_PROJECT}.supabase.co.evil.example/postgres`, CI), null);
  assert.equal(targetKind(`postgresql://postgres.${PRODUCTION_PROJECT}:pw@evil.example:5432/postgres`, CI), null);
  assert.equal(targetKind(`postgresql://postgres.${PRODUCTION_PROJECT}x:pw@aws-0-ap-south-1.pooler.supabase.com/postgres`, CI), null);
});

test('projectRefOf reads only the exact Supabase hosts', () => {
  assert.equal(projectRefOf(prodPooler), PRODUCTION_PROJECT);
  assert.equal(projectRefOf(prodDirect), PRODUCTION_PROJECT);
  assert.equal(projectRefOf(local), null);
  assert.equal(projectRefOf(`postgresql://postgres.${PRODUCTION_PROJECT}:pw@example.com/postgres`), null);
});

test('withDb needs the caller to opt in as well: a seed or reset script can never reach production', async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, CI);
    await assert.rejects(withDb(prodPooler, async () => 'reached'), /has no production path/);
    await assert.rejects(withDb(stagingPooler, async () => 'reached', { production: true }), /accepts only the production project/);
    delete process.env.PRODUCTION_DEPLOY;
    await assert.rejects(withDb(prodPooler, async () => 'reached', { production: true }), /only localhost and the test project/);
    await assert.rejects(withDb(stagingPooler, async () => 'reached', { production: 'only' }), /runs on production only/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('the production address is built from the password with the ref fixed in code', () => {
  const url = productionUrl('p@ss/w:rd#1');
  assert.equal(projectRefOf(url), PRODUCTION_PROJECT);
  assert.equal(decodeURIComponent(new URL(url).password), 'p@ss/w:rd#1');
  assert.equal(new URL(productionUrl('x', 'aws-1-ap-south-1.pooler.supabase.com')).hostname, 'aws-1-ap-south-1.pooler.supabase.com');
  assert.throws(() => productionUrl(''), /PROD_SUPABASE_DB_PASSWORD/);
  assert.throws(() => productionUrl('x', 'evil.example'), /PROD_SUPABASE_POOLER_HOST/);
});

// ------------------------------------------------------- database checks --

const settings = { dev_otp_for_all: false, admin_require_mfa: true, payout_method: 'manual', ...EXPECTED_SETTINGS };
const cleanDb = {
  settings,
  environment: 'production',
  pg_graphql: false,
  anon_table_rights: 0,
  open_defaults: [],
  authenticator_config: ['pgrst.db_pre_request=private.require_gateway', 'pgrst.openapi_mode=disabled'],
  realtime_public_tables: 0,
  vault_forbidden: [],
  razorpay_prefixes: { RAZORPAY_KEY_ID: 'rzp_live_' },
  gateway_secret: true,
};
const codesDb = (patch) => criticalOf(judgeDatabase({ ...cleanDb, ...patch })).map((f) => f.code);

test('a clean production database has no finding at all', () => {
  assert.deepEqual(judgeDatabase(cleanDb), []);
});

test('each bad database state is caught as critical', () => {
  assert.deepEqual(codesDb({ settings: { ...settings, dev_otp_for_all: true } }), ['DEV_OTP_FOR_ALL_ON']);
  assert.deepEqual(codesDb({ settings: { ...settings, dev_otp_for_all: undefined } }), ['DEV_OTP_FOR_ALL_ON']); // missing reads as on
  assert.deepEqual(codesDb({ settings: { ...settings, dev_otp_for_all: 'true' } }), ['DEV_OTP_FOR_ALL_ON']);
  assert.deepEqual(codesDb({ settings: { ...settings, admin_require_mfa: false } }), ['ADMIN_MFA_OFF']);
  assert.deepEqual(codesDb({ environment: 'staging' }), ['ENVIRONMENT_NOT_PRODUCTION']);
  assert.deepEqual(codesDb({ environment: null }), ['ENVIRONMENT_NOT_PRODUCTION']);
  assert.deepEqual(codesDb({ pg_graphql: true }), ['PG_GRAPHQL_ON']);
  assert.deepEqual(codesDb({ anon_table_rights: 3 }), ['ANON_TABLE_RIGHTS']);
  assert.deepEqual(codesDb({ open_defaults: ['r:anon'] }), ['DEFAULT_PRIVILEGES_OPEN']);
  assert.deepEqual(codesDb({ authenticator_config: [] }), ['DIRECT_DOOR_OPEN', 'DIRECT_DOOR_OPEN']);
  assert.deepEqual(codesDb({ authenticator_config: ['pgrst.openapi_mode=disabled'] }), ['DIRECT_DOOR_OPEN']);
  assert.deepEqual(codesDb({ realtime_public_tables: 1 }), ['LIVE_TABLE_BROADCASTS']);
  assert.deepEqual(codesDb({ vault_forbidden: ['ALLOW_ANY_OTP', 'TEST_PHONES'] }), ['ALLOW_ANY_OTP_SET', 'TEST_PHONES_SET']);
  assert.deepEqual(codesDb({ razorpay_prefixes: { RAZORPAY_KEY_ID: 'rzp_test_' } }), ['RAZORPAY_KEY_ID_IS_TEST_KEY']);
  assert.deepEqual(codesDb({ razorpay_prefixes: { RAZORPAYX_KEY_ID: 'rzp_test_' } }), ['RAZORPAYX_KEY_ID_IS_TEST_KEY']);
  assert.deepEqual(codesDb({ gateway_secret: false }), ['GATEWAY_SECRET_MISSING']);
});

test('an unreadable or empty state never reads as safe', () => {
  const codes = criticalOf(judgeDatabase({})).map((f) => f.code);
  for (const c of ['DEV_OTP_FOR_ALL_ON', 'ADMIN_MFA_OFF', 'ENVIRONMENT_NOT_PRODUCTION', 'PG_GRAPHQL_ON', 'ANON_TABLE_RIGHTS', 'DEFAULT_PRIVILEGES_OPEN', 'DIRECT_DOOR_OPEN', 'GATEWAY_SECRET_MISSING']) {
    assert.ok(codes.includes(c), c);
  }
});

test('a changed money setting is a warning, not an alarm', () => {
  const f = judgeDatabase({ ...cleanDb, settings: { ...settings, worker_commission_pct: 0.12, promotion_durations_days: [1, 3], payout_method: 'razorpayx' } });
  assert.deepEqual(criticalOf(f), []);
  assert.deepEqual(f.map((x) => x.code).sort(), ['SETTING_PROMOTION_DURATIONS_DAYS', 'SETTING_WORKER_COMMISSION_PCT']);
  assert.ok(judgeDatabase({ ...cleanDb, settings: { ...settings, worker_commission_pct: '0.10' } }).length === 0); // jsonb number as text
});

// ------------------------------------------------------- platform checks --

const config = `project_id = "x"
[functions.phone-auth]
verify_jwt = false
[functions.api]
verify_jwt = true
# [functions.fake] verify_jwt = false
[functions.razorpayx-webhook]
verify_jwt = false  # RazorpayX signs its calls
[auth]
verify_jwt = false
`;

test('the expected login check comes from config.toml, default on', () => {
  assert.deepEqual(expectedVerifyJwt(config, ['api', 'phone-auth', 'razorpayx-webhook', 'places-search']), {
    api: true, 'phone-auth': false, 'razorpayx-webhook': false, 'places-search': true,
  });
});

const expected = { api: true, 'phone-auth': false, 'razorpayx-webhook': false };
const cleanPlatform = {
  secretNames: ['SENTRY_DSN', 'INNGEST_SIGNING_KEY'],
  functions: [{ slug: 'api', verify_jwt: true }, { slug: 'phone-auth', verify_jwt: false }, { slug: 'razorpayx-webhook', verify_jwt: false }],
  auth: {
    hook_before_user_created_enabled: true,
    hook_before_user_created_uri: 'pg-functions://postgres/public/hook_before_user_created',
    external_anonymous_users_enabled: false,
    external_phone_enabled: false,
  },
};
const codesP = (patch, opts) => criticalOf(judgePlatform({ ...cleanPlatform, ...patch }, expected, opts)).map((f) => f.code);

test('a clean platform has no finding', () => {
  assert.deepEqual(judgePlatform(cleanPlatform, expected), []);
});

test('each bad platform state is caught as critical', () => {
  assert.deepEqual(codesP({ secretNames: ['ALLOW_ANY_OTP'] }), ['ALLOW_ANY_OTP_SET']);
  assert.deepEqual(codesP({ secretNames: ['TEST_PHONES'] }), ['TEST_PHONES_SET']);
  assert.deepEqual(codesP({ secretNames: ['APP_CHECK_DEBUG_TOKEN', 'EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN'] }), ['APP_CHECK_DEBUG_TOKEN_SET', 'EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN_SET']);
  assert.deepEqual(codesP({ functions: cleanPlatform.functions.map((f) => (f.slug === 'razorpayx-webhook' ? { ...f, verify_jwt: true } : f)) }), ['VERIFY_JWT_razorpayx-webhook']);
  assert.deepEqual(codesP({ functions: cleanPlatform.functions.filter((f) => f.slug !== 'api') }), ['FUNCTION_MISSING_api']);
  assert.deepEqual(codesP({ auth: { ...cleanPlatform.auth, hook_before_user_created_enabled: false } }), ['SIGNUP_GUARD_HOOK_OFF']);
  assert.deepEqual(codesP({ auth: { ...cleanPlatform.auth, hook_before_user_created_uri: 'pg-functions://postgres/public/other' } }), ['SIGNUP_GUARD_HOOK_OFF']);
  assert.deepEqual(codesP({ auth: { ...cleanPlatform.auth, external_anonymous_users_enabled: true } }), ['ANONYMOUS_SIGN_IN_ON']);
  assert.deepEqual(codesP({ auth: { ...cleanPlatform.auth, external_phone_enabled: true } }), ['SUPABASE_PHONE_SIGN_IN_ON']);
});

test('before the owner\'s dashboard clicks, the deploy reports sign-in settings as warnings only', () => {
  const p = { auth: { ...cleanPlatform.auth, hook_before_user_created_enabled: false } };
  assert.deepEqual(codesP(p, { dashboardPending: true }), []);
  assert.deepEqual(codesP({ ...p, secretNames: ['ALLOW_ANY_OTP'] }, { dashboardPending: true }), ['ALLOW_ANY_OTP_SET']); // never downgraded
});

test('no token is a warning, never a pass in silence', () => {
  assert.deepEqual(judgePlatform(null, expected).map((f) => [f.level, f.code]), [['warning', 'PLATFORM_NOT_CHECKED']]);
});

test('the outside check covers every name the inside Inngest alarm forbids', () => {
  for (const name of FORBIDDEN_IN_PRODUCTION) assert.ok(FORBIDDEN_SECRET_NAMES.includes(name), name);
});

// ---------------------------------------------------------------- Sentry --

const DSN = 'https://abc123publickey@o123.ingest.us.sentry.io/4507654321'; // throwaway, not a real project

test('a Sentry DSN is split into the envelope endpoint and the public key; anything else is refused', () => {
  assert.deepEqual(parseDsn(DSN), { publicKey: 'abc123publickey', endpoint: 'https://o123.ingest.us.sentry.io/api/4507654321/envelope/' });
  assert.equal(parseDsn(''), null);
  assert.equal(parseDsn(undefined), null);
  assert.equal(parseDsn('http://k@host/1'), null);
  assert.equal(parseDsn('https://host/1'), null);
  assert.equal(parseDsn('https://k@host/notanumber'), null);
});

test('the alarm sends one fatal event naming codes only, grouped by the set of codes', async () => {
  const findings = [...judgeDatabase({ ...cleanDb, environment: 'staging' }), { level: 'warning', code: 'X', what: 'w' }];
  const body = sentryEnvelope(findings, { eventId: 'a'.repeat(32), now: new Date(0) });
  const [header, item, event] = body.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(header.event_id, 'a'.repeat(32));
  assert.equal(item.type, 'event');
  assert.equal(event.level, 'fatal');
  assert.equal(event.environment, 'production');
  assert.deepEqual(event.fingerprint, ['production-safety-alarm', 'ENVIRONMENT_NOT_PRODUCTION']);
  assert.equal(event.message.formatted, alarmLine(findings));
  assert.ok(!body.includes('abc123publickey'));

  const calls = [];
  const ok = async (url, init) => (calls.push({ url, init }), { ok: true, status: 200 });
  await sendToSentry(DSN, findings, { fetchImpl: ok, eventId: 'b'.repeat(32) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://o123.ingest.us.sentry.io/api/4507654321/envelope/');
  assert.match(calls[0].init.headers['X-Sentry-Auth'], /sentry_key=abc123publickey/);

  await assert.rejects(sendToSentry(DSN, findings, { fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
  await assert.rejects(sendToSentry('', findings, { fetchImpl: ok }), /PROD_SENTRY_DSN/);
});

// ------------------------------------------------------------- workflows --


const wf = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

test('the production deploy waits for the approval environment, runs from redesigned-2.0 only, and passes every function secret', () => {
  const y = wf('production-database.yml');
  assert.match(y, /environment: production-database/);
  assert.match(y, /if: github\.ref == 'refs\/heads\/redesigned-2\.0'/);
  assert.match(y, /PROD_SUPABASE_PROJECT_ID: dyzskuzqcqbexssyrrxc/);
  for (const name of allowList(true)) assert.ok(y.includes(`PROD_${name}: \${{ secrets.PROD_${name} }}`), name);
  for (const name of ['ALLOW_ANY_OTP', 'TEST_PHONES']) assert.ok(!y.includes(`PROD_${name}:`), name);
  // the plan job holds no secret
  const plan = y.slice(y.indexOf('\n  plan:'), y.indexOf('\n  deploy:'));
  assert.ok(!plan.includes('${{ secrets.'));
  // it never starts by itself: a merge must not queue a production run (plan decision 57)
  const on = y.slice(y.indexOf('\non:'), y.indexOf('\npermissions:'));
  assert.ok(!/\n\s+push:|\n\s+schedule:|\n\s+pull_request/.test(on), 'production-database must not start on push');
  assert.match(on, /workflow_call:/);
});

test('production moves as one release: guard, then database, then website, then a check; staging never deploys production', () => {
  const y = wf('release-production.yml');
  const on = y.slice(y.indexOf('\non:'), y.indexOf('\nconcurrency:'));
  assert.match(on, /workflow_dispatch:/);
  assert.ok(!/\n\s+push:|\n\s+schedule:|\n\s+pull_request|workflow_call/.test(on), 'the release starts by hand only');
  assert.match(y, /refs\/heads\/redesigned-2\.0/);
  assert.match(y, /database:\r?\n(?:.*\n)*?    needs: guard\r?\n    uses: \.\/\.github\/workflows\/production-database\.yml/);
  assert.match(y, /web:\r?\n(?:.*\n)*?    needs: database\r?\n    uses: \.\/\.github\/workflows\/web-deploy\.yml/);
  assert.match(y, /needs: \[database, web\]/);
  assert.ok(!/^\s*secrets:\s*inherit\s*$/m.test(y), 'pass named secrets, never all of them');
  assert.match(y, /cancel-in-progress: false/);
  // only the tagging job may write, and only tags
  assert.equal((y.match(/contents: write/g) || []).length, 1);
  const staging = wf('deploy-staging.yml');
  assert.ok(!staging.includes('target: production'), 'deploy-staging must not deploy production');
  // A called job that sets `environment` only sees a secret its caller passed by name (the first release run,
  // 27 Nov, stopped with an empty database password). Every secret a called workflow reads must be declared by
  // it and passed by each caller.
  const read = (text) => [...new Set([...text.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g)].map((m) => m[1]))];
  const declared = (text, name) => new RegExp(`\\n      ${name}:\\r?\\n        required: false`).test(text);
  const db = wf('production-database.yml');
  const web = wf('web-deploy.yml');
  for (const name of read(db)) {
    assert.ok(declared(db, name), `production-database.yml must declare ${name}`);
    assert.ok(y.includes(`      ${name}: \${{ secrets.${name} }}`), `the release must pass ${name}`);
  }
  for (const name of read(web)) {
    assert.ok(declared(web, name), `web-deploy.yml must declare ${name}`);
    assert.ok(y.includes(`      ${name}: \${{ secrets.${name} }}`), `the release must pass ${name}`);
    assert.ok(staging.includes(`      ${name}: \${{ secrets.${name} }}`), `deploy-staging must pass ${name}`);
  }
});

test('the hourly alarm and the nightly copy run from redesigned-2.0 in their own environment', () => {
  for (const name of ['production-alarm.yml', 'production-backup.yml']) {
    const y = wf(name);
    assert.match(y, /environment: production-backup/, name);
    assert.match(y, /if: github\.ref == 'refs\/heads\/redesigned-2\.0'/, name);
    assert.match(y, /schedule:/, name);
  }
  assert.match(wf('production-backup.yml'), /30 days ago/);
  assert.match(wf('production-backup.yml'), /--symmetric --cipher-algo AES256/);
  assert.match(wf('production-backup.yml'), /refuse a public or missing backup repository/);
  assert.ok(!wf('production-backup.yml').includes('upload-artifact'), 'no artifact in the public repository');
});
