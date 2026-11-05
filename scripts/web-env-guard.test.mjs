// Tests for the staging noindex step. Run from the repo root:
//   node --test scripts/web-env-guard.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyToHtml, DEFAULT_ORIGIN, isProductionBuild, NOINDEX_META, originOf, ROBOTS_TXT, run, securityTxt, SECURITY_TXT_EXPIRES, SUPPORT_URL } from '../apps/mobile/scripts/web-env-guard.mjs';

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

test('security.txt names the support address and page, an expiry and the canonical address', () => {
  const withMail = securityTxt('help@example.in', new Date('2026-11-03'));
  assert.ok(withMail.split(NL).includes('Contact: mailto:help@example.in'));
  assert.ok(withMail.split(NL).includes(`Contact: ${SUPPORT_URL}`));
  assert.ok(withMail.split(NL).includes(`Expires: ${SECURITY_TXT_EXPIRES}`));
  assert.ok(withMail.split(NL).includes('Canonical: https://taskdrop.in/.well-known/security.txt'));
  const noMail = securityTxt('', new Date('2026-11-03'));
  assert.ok(!noMail.includes('mailto:'));
  assert.ok(noMail.split(NL).includes(`Contact: ${SUPPORT_URL}`));
  assert.ok(!securityTxt('not an address', new Date('2026-11-03')).includes('mailto:'));
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
      run(dist, env, 'help@example.in');
      assert.ok(readFileSync(join(dist, '.well-known', 'security.txt'), 'utf8').includes('mailto:help@example.in'));
    }
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
