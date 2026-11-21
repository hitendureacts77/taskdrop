// Tests for the staging noindex step. Run from the repo root:
//   node --test scripts/web-env-guard.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyToHtml, assetLinks, DEFAULT_ORIGIN, fingerprintsOf, isProductionBuild, NOINDEX_META, originOf, PRODUCTION_ANDROID_PACKAGE, PUBLIC_EMAIL, publicEmail, ROBOTS_TXT, run, securityTxt, SECURITY_TXT_EXPIRES, SUPPORT_URL } from '../apps/mobile/scripts/web-env-guard.mjs';

const NL = String.fromCharCode(10);
const HTML = '<!DOCTYPE html><html><head><title>TaskDrop</title></head><body></body></html>';

test('only "production" is production; unset or odd values are staging', () => {
  assert.equal(isProductionBuild('production'), true);
  assert.equal(isProductionBuild(' Production '), true);
  for (const v of [undefined, '', 'staging', 'prod', 'alpha', 'true']) assert.equal(isProductionBuild(v), false);
});

test('staging adds noindex once, even if run twice', () => {
  const once = applyToHtml(HTML, false);
  assert.ok(once.includes(`${NOINDEX_META}</head>`));
  assert.equal(applyToHtml(once, false), once);
});

test('production adds nothing and removes a leftover noindex', () => {
  assert.equal(applyToHtml(HTML, true), HTML);
  assert.equal(applyToHtml(applyToHtml(HTML, false), true), HTML);
});

test('run(): staging writes robots.txt that blocks everyone; production does not', () => {
  const dist = mkdtempSync(join(tmpdir(), 'td-guard-'));
  try {
    writeFileSync(join(dist, 'index.html'), HTML);
    assert.equal(run(dist, undefined), 'staging');
    assert.equal(readFileSync(join(dist, 'robots.txt'), 'utf8'), ROBOTS_TXT);
    assert.match(ROBOTS_TXT, /User-agent: \*\r?\nDisallow: \/\r?\n/);
    assert.equal(run(dist, 'production'), 'production');
    assert.equal(existsSync(join(dist, 'robots.txt')), false);
    assert.equal(readFileSync(join(dist, 'index.html'), 'utf8'), HTML);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('vercel.json: noindex header is limited to staging hosts, never a catch-all', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rules = cfg.headers.filter((r) => r.headers.some((h) => h.key === 'X-Robots-Tag'));
  assert.ok(rules.length > 0, 'staging sends X-Robots-Tag');
  for (const r of rules) {
    assert.ok(r.headers.some((h) => h.key === 'X-Robots-Tag' && /noindex/.test(h.value)));
    assert.ok(Array.isArray(r.has) && r.has.some((c) => c.type === 'host'), 'X-Robots-Tag rule must be host-scoped');
  }
});

test('vercel.json: staging hosts are noindex, and the production addresses are not (plan 5.0a, 5.10)', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const patterns = cfg.headers
    .filter((r) => r.headers.some((h) => h.key === 'X-Robots-Tag'))
    .flatMap((r) => r.has.filter((c) => c.type === 'host').map((c) => new RegExp(`^(?:${c.value})$`)));
  const hidden = (host) => patterns.some((p) => p.test(host));
  for (const host of [
    'taskdrop.in',
    'www.taskdrop.in',
    'taskdrop-five.vercel.app',
    'taskdrop-git-redesigned-20-hitenduteam.vercel.app',
    'taskdrop-git-feat-something-hitenduteam.vercel.app',
    'taskdrop-a1b2c3d4e-hitenduteam.vercel.app',
  ]) assert.equal(hidden(host), true, `${host} must send noindex`);
  for (const host of [
    'taskdrop-production.vercel.app',
    'taskdrop-production-a1b2c3d4e-hitenduteam.vercel.app',
    'taskdrop-production-git-main-hitenduteam.vercel.app',
  ]) assert.equal(hidden(host), false, `${host} must not send noindex`);
});

test('vercel.json: production reports security problems to its own Sentry project, with the same rules as staging (plan 5.10)', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const cspRules = cfg.headers.filter((r) => r.headers.some((h) => h.key === 'Content-Security-Policy'));
  const everywhere = cspRules.find((r) => !r.has);
  const production = cspRules.find((r) => r.has?.some((c) => c.type === 'host' && new RegExp(`^(?:${c.value})$`).test('taskdrop-production.vercel.app')));
  assert.ok(everywhere && production, 'a catch-all rule and a production rule');
  const value = (r) => r.headers.find((h) => h.key === 'Content-Security-Policy').value;
  const split = (v) => { const i = v.indexOf('; report-uri '); return [v.slice(0, i), v.slice(i + '; report-uri '.length)]; };
  const [stagingRulesRaw, stagingReport] = split(value(everywhere));
  const [productionRules, productionReport] = split(value(production));
  // B152: staging (Vercel preview deployments) loads the Vercel toolbar, so its rules may add the toolbar's own
  // sources and nothing else. Production never gets them.
  const TOOLBAR = [' https://vercel.live', ' https://assets.vercel.com', ' wss://ws-us3.pusher.com'];
  const stagingRules = TOOLBAR.reduce((v, s) => v.split(s).join(''), stagingRulesRaw);
  assert.equal(productionRules, stagingRules, 'only the report address and the staging toolbar may differ, so the two rule sets cannot drift');
  assert.ok(!/vercel\.live|pusher\.com/.test(productionRules), 'production does not allow the Vercel toolbar');
  assert.notEqual(productionReport, stagingReport, 'production must not report into the staging project');
  assert.match(productionReport, /^https:\/\/o\d+\.ingest\.[a-z.]*sentry\.io\/api\/\d+\/security\/\?sentry_key=[0-9a-f]+$/);
  // The production rule must never match a staging address, or staging errors would land in production's Sentry.
  const hostRe = new RegExp(`^(?:${production.has.find((c) => c.type === 'host').value})$`);
  for (const host of ['taskdrop.in', 'www.taskdrop.in', 'taskdrop-five.vercel.app', 'taskdrop-git-redesigned-20-hitenduteam.vercel.app']) {
    assert.equal(hostRe.test(host), false, `${host} must keep staging's report address`);
  }
  assert.ok(cfg.headers.indexOf(production) > cfg.headers.indexOf(everywhere), 'the production rule comes after the catch-all so it wins');
});

const FP_A = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':');
const FP_B = Array.from({ length: 32 }, () => 'AB').join(':');
const SHA1 = '1F:22:C8:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:E5:D1';

test('assetlinks.json: only real SHA-256 fingerprints count, and no fingerprint means no file', () => {
  assert.deepEqual(fingerprintsOf(`${FP_A.toLowerCase()}, ${FP_B} ,${SHA1}, nonsense`), [FP_A, FP_B]);
  assert.deepEqual(fingerprintsOf(undefined), []);
  assert.equal(assetLinks([]), null);
  const parsed = JSON.parse(assetLinks([FP_A, FP_B]));
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(parsed[0].target.namespace, 'android_app');
  assert.equal(parsed[0].target.package_name, PRODUCTION_ANDROID_PACKAGE);
  assert.equal(PRODUCTION_ANDROID_PACKAGE, 'com.taskdrop.app', 'never the staging package');
  assert.deepEqual(parsed[0].target.sha256_cert_fingerprints, [FP_A, FP_B]);
});

test('build: production with a fingerprint writes assetlinks.json; staging and production without one do not', () => {
  const make = () => {
    const dist = mkdtempSync(join(tmpdir(), 'wg-'));
    writeFileSync(join(dist, 'index.html'), HTML);
    return dist;
  };
  const file = (dist) => join(dist, '.well-known', 'assetlinks.json');
  const a = make();
  const b = make();
  const c = make();
  const d = make();
  try {
    run(a, 'production', 'x@example.in', 'https://prod.example', FP_A);
    assert.equal(JSON.parse(readFileSync(file(a), 'utf8'))[0].target.sha256_cert_fingerprints[0], FP_A);
    run(b, 'staging', 'x@example.in', 'https://stage.example', FP_A);
    assert.equal(existsSync(file(b)), false, 'the staging app has its own package and gets no file');
    run(c, 'production', 'x@example.in', 'https://prod.example', '');
    assert.equal(existsSync(file(c)), false);
    run(d, 'production', 'x@example.in', 'https://prod.example', FP_A);
    run(d, 'production', 'x@example.in', 'https://prod.example', SHA1);
    assert.equal(existsSync(file(d)), false, 'a stale file is removed when the fingerprints go away');
  } finally {
    for (const x of [a, b, c, d]) rmSync(x, { recursive: true, force: true });
  }
});

test('security.txt names the support address and page, an expiry and the canonical address', () => {
  const withMail = securityTxt('Help@TaskDrop.in', new Date('2026-11-03'));
  assert.ok(withMail.split(NL).includes('Contact: mailto:help@taskdrop.in'));
  assert.ok(withMail.split(NL).includes(`Contact: ${SUPPORT_URL}`));
  assert.ok(withMail.split(NL).includes(`Expires: ${SECURITY_TXT_EXPIRES}`));
  assert.ok(withMail.split(NL).includes('Canonical: https://taskdrop.in/.well-known/security.txt'));
  const noMail = securityTxt('', new Date('2026-11-03'));
  assert.ok(noMail.split(NL).includes(`Contact: mailto:${PUBLIC_EMAIL}`));
  assert.ok(noMail.split(NL).includes(`Contact: ${SUPPORT_URL}`));
});

test('a personal inbox is never published: anything not at taskdrop.in becomes admin@taskdrop.in', () => {
  assert.equal(PUBLIC_EMAIL, 'admin@taskdrop.in');
  for (const v of ['someone@gmail.com', 'x@taskdrop.in.evil.com', 'x@sub.taskdrop.in', 'not an address', '', null, undefined]) {
    assert.equal(publicEmail(v), PUBLIC_EMAIL, String(v));
    assert.ok(!securityTxt(v, new Date('2026-11-03')).includes('gmail'), String(v));
  }
  assert.equal(publicEmail(' Support@taskdrop.in '), 'support@taskdrop.in');
});

test('security.txt names the address the build is served from (production has its own)', () => {
  const prod = securityTxt('help@example.in', new Date('2026-11-03'), 'https://taskdrop-production.vercel.app');
  assert.ok(prod.split(NL).includes('Canonical: https://taskdrop-production.vercel.app/.well-known/security.txt'));
  assert.ok(prod.split(NL).includes('Contact: https://taskdrop-production.vercel.app/?page=support'));
  assert.ok(!prod.includes('https://taskdrop.in'), 'no staging address in the production file');
});

test('originOf: EXPO_PUBLIC_APP_URL wins when it is a plain https address, otherwise staging\'s', () => {
  assert.equal(originOf('https://taskdrop-production.vercel.app/'), 'https://taskdrop-production.vercel.app');
  for (const v of [undefined, '', 'http://x.example', 'https://x.example/path', 'not a url']) assert.equal(originOf(v), DEFAULT_ORIGIN);
});

test('an expired security.txt stops the build instead of shipping', () => {
  assert.throws(() => securityTxt('', new Date('2027-11-01')), /expired/);
  assert.ok(Date.parse(SECURITY_TXT_EXPIRES) > Date.now(), 'move SECURITY_TXT_EXPIRES one year on');
});

test('run() writes .well-known/security.txt for both staging and production', () => {
  const dist = mkdtempSync(join(tmpdir(), 'td-guard-'));
  try {
    writeFileSync(join(dist, 'index.html'), HTML);
    for (const env of [undefined, 'production']) {
      run(dist, env, 'help@taskdrop.in');
      assert.ok(readFileSync(join(dist, '.well-known', 'security.txt'), 'utf8').includes('mailto:help@taskdrop.in'));
    }
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
