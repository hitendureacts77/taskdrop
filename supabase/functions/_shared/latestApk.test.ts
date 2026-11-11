import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_PROFILE, EXPO_APP_ID, fetchLatestApk, isExpoArtifactUrl, pickLatestApk } from './latestApk.ts';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const url = (id: string) => `https://expo.dev/artifacts/eas/${id}.apk`;
const build = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'FINISHED',
  appVersion: '1.1.0',
  createdAt,
  expirationDate: '2026-11-25T00:00:00Z',
  artifacts: { applicationArchiveUrl: url(id), buildUrl: url(id) },
  ...extra,
});

test('only https addresses under expo.dev/artifacts are accepted', () => {
  assert.equal(isExpoArtifactUrl(url('abc')), true);
  assert.equal(isExpoArtifactUrl('http://expo.dev/artifacts/eas/a.apk'), false);
  assert.equal(isExpoArtifactUrl('https://evil.example/artifacts/eas/a.apk'), false);
  assert.equal(isExpoArtifactUrl('https://expo.dev.evil.example/artifacts/a.apk'), false);
  assert.equal(isExpoArtifactUrl('https://expo.dev/accounts/x'), false);
  assert.equal(isExpoArtifactUrl('javascript:alert(1)'), false);
  assert.equal(isExpoArtifactUrl(null), false);
  assert.equal(isExpoArtifactUrl('not a url'), false);
});

test('the newest finished build wins, whatever order Expo lists them in', () => {
  const got = pickLatestApk([build('old', '2026-11-06T10:00:00Z'), build('new', '2026-11-10T10:00:00Z'), build('mid', '2026-11-08T10:00:00Z')], NOW);
  assert.equal(got?.url, url('new'));
  assert.equal(got?.version, '1.1.0');
});

test('builds that failed, are running, or whose file expired are skipped', () => {
  const got = pickLatestApk(
    [
      build('running', '2026-11-11T09:00:00Z', { status: 'IN_PROGRESS' }),
      build('errored', '2026-11-11T08:00:00Z', { status: 'ERRORED' }),
      build('expired', '2026-11-10T08:00:00Z', { expirationDate: '2026-11-11T00:00:00Z' }),
      build('good', '2026-11-09T08:00:00Z'),
    ],
    NOW,
  );
  assert.equal(got?.url, url('good'));
});

test('a build with no file, or a file on another host, is never offered', () => {
  assert.equal(pickLatestApk([build('x', '2026-11-10T10:00:00Z', { artifacts: null })], NOW), null);
  assert.equal(pickLatestApk([build('x', '2026-11-10T10:00:00Z', { artifacts: { applicationArchiveUrl: 'https://evil.example/a.apk' } })], NOW), null);
});

test('no builds gives null, not an error', () => {
  assert.equal(pickLatestApk([], NOW), null);
  assert.equal(pickLatestApk(null, NOW), null);
  assert.equal(pickLatestApk(undefined, NOW), null);
});

test('fetchLatestApk asks Expo for finished Android builds of the beta profile, with the token as a header', async () => {
  let seen: { url: string; headers: Record<string, string>; body: { variables: { appId: string; filter: Record<string, string> } } } | null = null;
  const fetchFn = async (u: string, init: { headers: Record<string, string>; body: string }) => {
    seen = { url: u, headers: init.headers, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ data: { app: { byId: { builds: [build('b1', '2026-11-10T10:00:00Z')] } } } }) };
  };
  const got = await fetchLatestApk('tok-123', fetchFn, NOW);
  assert.equal(got?.url, url('b1'));
  assert.equal(seen!.url, 'https://api.expo.dev/graphql');
  assert.equal(seen!.headers.authorization, 'Bearer tok-123');
  assert.equal(seen!.body.variables.appId, EXPO_APP_ID);
  assert.deepEqual(seen!.body.variables.filter, { platform: 'ANDROID', status: 'FINISHED', buildProfile: BUILD_PROFILE });
});

test('fetchLatestApk throws when Expo refuses or answers with errors (the caller decides what to show)', async () => {
  await assert.rejects(fetchLatestApk('t', async () => ({ ok: false, status: 401, json: async () => ({}) }), NOW), /401/);
  await assert.rejects(fetchLatestApk('t', async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'x' }] }) }), NOW), /refused/);
});

test('the token never appears in the question sent as the body', async () => {
  let body = '';
  await fetchLatestApk('SECRET-VALUE', async (_u, init) => {
    body = init.body;
    return { ok: true, status: 200, json: async () => ({ data: { app: { byId: { builds: [] } } } }) };
  }, NOW);
  assert.ok(!body.includes('SECRET-VALUE'));
});
