// node --test apps/mobile/variant.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const v = require('./variant.cjs');
const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'app.json'), 'utf8')).expo;
const appConfig = require('./app.config.js');

const STAGING_URL = `https://${v.STAGING_SUPABASE_REF}.supabase.co`;
const PROD_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const PROD_OK = {
  APP_VARIANT: 'production',
  EXPO_PUBLIC_SUPABASE_URL: PROD_URL,
  EXPO_PUBLIC_SENTRY_ENVIRONMENT: 'production',
  EXPO_PUBLIC_APP_URL: 'https://taskdrop-production.vercel.app',
  TASKDROP_PRODUCTION_EAS_PROJECT_ID: '11111111-2222-3333-4444-555555555555',
};

test('a missing or play-testing variant is today\'s app, unchanged', () => {
  assert.equal(v.resolveVariant({}), 'play-testing');
  assert.equal(v.applyVariant(appJson, {}), appJson);
  assert.equal(v.applyVariant(appJson, { APP_VARIANT: 'play-testing' }), appJson);
  assert.deepEqual(v.checkVariant({ EXPO_PUBLIC_SUPABASE_URL: STAGING_URL }), []);
});

test('the staging variant is a separate app that can sit beside the others', () => {
  const out = v.applyVariant(appJson, { APP_VARIANT: 'staging' });
  assert.equal(out.name, 'TaskDrop Staging');
  assert.equal(out.android.package, 'com.taskdrop.app.staging');
  assert.equal(out.scheme, 'taskdrop-staging');
  assert.notEqual(out.android.package, appJson.android.package);
  assert.notEqual(out.scheme, appJson.scheme);
  assert.equal(out.slug, appJson.slug);
  assert.equal(out.extra.eas.projectId, v.STAGING_EAS_PROJECT_ID);
  assert.equal(out.updates.url, `https://u.expo.dev/${v.STAGING_EAS_PROJECT_ID}`);
  assert.equal(v.sentryProject({ APP_VARIANT: 'staging' }), 'taskdrop');
  // the original is never edited
  assert.equal(appJson.android.package, 'com.taskdrop.app');
});

test('the staging icons exist', () => {
  const out = v.applyVariant(appJson, { APP_VARIANT: 'staging' });
  for (const f of [out.icon, out.android.adaptiveIcon.foregroundImage]) {
    assert.ok(fs.existsSync(path.join(__dirname, f)), f);
  }
});

test('the production variant keeps the real package and has its own Expo project', () => {
  const out = v.applyVariant(appJson, PROD_OK);
  assert.equal(out.android.package, 'com.taskdrop.app');
  assert.equal(out.name, 'TaskDrop');
  assert.equal(out.scheme, 'taskdrop');
  assert.equal(out.slug, 'taskdrop-production');
  assert.equal(out.extra.eas.projectId, PROD_OK.TASKDROP_PRODUCTION_EAS_PROJECT_ID);
  assert.equal(out.updates.url, `https://u.expo.dev/${PROD_OK.TASKDROP_PRODUCTION_EAS_PROJECT_ID}`);
  assert.notEqual(out.updates.url, appJson.updates.url);
  assert.equal(v.sentryProject(PROD_OK), 'taskdrop-production');
});

test('a production config never keeps the staging Expo project, even with no project id', () => {
  const out = v.applyVariant(appJson, { APP_VARIANT: 'production' });
  assert.equal(out.extra.eas, undefined);
  assert.equal(out.updates, undefined);
  assert.doesNotMatch(JSON.stringify(out), new RegExp(v.STAGING_EAS_PROJECT_ID));
});

test('a complete production build passes the guard', () => {
  assert.deepEqual(v.checkVariant(PROD_OK, { androidBuild: true }), []);
});

test('the guard refuses a production build that sees the staging server', () => {
  const p = v.checkVariant({ ...PROD_OK, EXPO_PUBLIC_SUPABASE_URL: STAGING_URL }, { androidBuild: true });
  assert.equal(p.length, 1);
  assert.match(p[0], /STAGING server/);
});

test('the guard refuses a production Android build with no server, project or app address', () => {
  const p = v.checkVariant({ APP_VARIANT: 'production' }, { androidBuild: true });
  assert.equal(p.length, 3);
  // a production WEB build needs none of those three
  assert.deepEqual(v.checkVariant({ APP_VARIANT: 'production' }, { androidBuild: false }), []);
});

test('the guard refuses test shortcuts and test keys in production', () => {
  for (const name of ['EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN', 'ALLOW_ANY_OTP', 'TEST_PHONES']) {
    const p = v.checkVariant({ ...PROD_OK, [name]: 'x' }, { androidBuild: true });
    assert.equal(p.length, 1, name);
    assert.ok(p[0].includes(name));
    assert.ok(!p[0].includes('"x"'));
  }
  const key = 'rzp_test_' + 'abc123';
  const p = v.checkVariant({ ...PROD_OK, SOME_KEY: key }, { androidBuild: true });
  assert.equal(p.length, 1);
  assert.ok(p[0].includes('SOME_KEY'));
  assert.ok(!p[0].includes(key), 'the guard must not print the value');
});

test('the guard refuses staging settings in production and production settings in staging', () => {
  assert.equal(v.checkVariant({ ...PROD_OK, EXPO_PUBLIC_SENTRY_ENVIRONMENT: 'beta' }, { androidBuild: true }).length, 1);
  assert.equal(v.checkVariant({ ...PROD_OK, EXPO_PUBLIC_APP_ENV: 'staging' }, { androidBuild: true }).length, 1);
  assert.equal(v.checkVariant({ ...PROD_OK, EXPO_PUBLIC_APP_URL: 'https://taskdrop.in' }, { androidBuild: true }).length, 1);
  assert.equal(v.checkVariant({ ...PROD_OK, EXPO_PUBLIC_APP_URL: 'https://www.taskdrop.in/' }, { androidBuild: true }).length, 1);
  assert.equal(v.checkVariant({ APP_VARIANT: 'staging', EXPO_PUBLIC_SUPABASE_URL: PROD_URL }).length, 1);
  // the staging website's Vercel project labels its error reports "production" (a label only): not a mix-up
  assert.deepEqual(v.checkVariant({ APP_VARIANT: 'staging', EXPO_PUBLIC_SENTRY_ENVIRONMENT: 'production' }), []);
  assert.deepEqual(v.checkVariant({ EXPO_PUBLIC_SUPABASE_URL: STAGING_URL, EXPO_PUBLIC_SENTRY_ENVIRONMENT: 'production' }), []);
  assert.equal(v.checkVariant({ APP_VARIANT: 'staging', EXPO_PUBLIC_APP_ENV: 'production' }).length, 1);
  assert.equal(v.checkVariant({ APP_VARIANT: 'staging', EXPO_PUBLIC_SUPABASE_URL: STAGING_URL, X: 'rzp_live_' + 'abc' }).length, 1);
  assert.deepEqual(v.checkVariant({ APP_VARIANT: 'staging', EXPO_PUBLIC_SUPABASE_URL: STAGING_URL, EXPO_PUBLIC_SENTRY_ENVIRONMENT: 'beta' }), []);
});

test('an unknown variant is refused', () => {
  const p = v.checkVariant({ APP_VARIANT: 'prod' });
  assert.equal(p.length, 1);
  assert.match(p[0], /APP_VARIANT/);
});

test('app.config.js throws on a mixed build and returns the variant otherwise', () => {
  const saved = { ...process.env };
  try {
    for (const k of Object.keys(process.env)) if (/^(APP_VARIANT|EXPO_PUBLIC_|TASKDROP_|ALLOW_ANY_OTP|TEST_PHONES|EAS_BUILD_PLATFORM)/.test(k)) delete process.env[k];
    const plain = appConfig({ config: { ...appJson } });
    assert.equal(plain.android.package, 'com.taskdrop.app');
    process.env.APP_VARIANT = 'staging';
    process.env.EXPO_PUBLIC_SUPABASE_URL = STAGING_URL;
    const staging = appConfig({ config: { ...appJson } });
    assert.equal(staging.android.package, 'com.taskdrop.app.staging');
    process.env.APP_VARIANT = 'production';
    assert.throws(() => appConfig({ config: { ...appJson } }), /Build stopped/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
