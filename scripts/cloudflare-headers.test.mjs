// Tests for the Cloudflare _headers / _redirects generation. Run from the repo root:
//   node --test scripts/cloudflare-headers.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { exportEnv, parseTarget } from './cloudflare-web-build.mjs';
import { headersFor, renderHeadersFile, renderRedirectsFile, routesFor, stripVercelToolbar, unhashedAssets, vercelSourceToPattern } from './lib/cloudflare-headers.mjs';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const csp = (text) => /Content-Security-Policy: (.*)/.exec(text)[1];

test('stripVercelToolbar drops only the toolbar sources', () => {
  const out = stripVercelToolbar("default-src 'self'; script-src 'self' https://a.test https://vercel.live; font-src 'self' https://assets.vercel.com; connect-src 'self' wss://ws-us3.pusher.com https://b.test");
  assert.equal(out, "default-src 'self'; script-src 'self' https://a.test; font-src 'self'; connect-src 'self' https://b.test");
});

test('staging: every base header, the staging CSP without vercel.live, noindex', () => {
  const text = renderHeadersFile(vercel, 'staging');
  for (const k of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'X-Frame-Options', 'Content-Security-Policy']) {
    assert.match(text, new RegExp(`^  ${k}: `, 'm'));
  }
  assert.match(text, /^  X-Robots-Tag: noindex, nofollow$/m);
  assert.doesNotMatch(text, /vercel\.live|assets\.vercel\.com|pusher/);
  assert.match(csp(text), /sentry_key=599a574f/); // the staging Sentry project
});

test('production: its own CSP, no X-Robots-Tag', () => {
  const text = renderHeadersFile(vercel, 'production');
  assert.doesNotMatch(text, /X-Robots-Tag/);
  assert.doesNotMatch(text, /vercel\.live|assets\.vercel\.com|pusher/);
  assert.match(csp(text), /sentry_key=c27bc327/); // the production Sentry project
  assert.equal((text.match(/Content-Security-Policy/g) ?? []).length, 1);
});

test('cache rules: hashed files long, the page never', () => {
  const text = renderHeadersFile(vercel, 'staging');
  assert.match(text, /^\/_expo\/static\/\*\n  Cache-Control: public, max-age=31536000, immutable$/m);
  assert.match(text, /^\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable$/m);
  assert.match(text, /^\/\n  Cache-Control: no-cache$/m);
  assert.match(text, /^\/index\.html\n  Cache-Control: no-cache$/m);
  // Plan 3.6: the per-address pages and the 404 page are copies of index.html, never cached either.
  for (const p of ['/terms', '/privacy', '/support', '/copyright', '/get', '/404.html']) {
    assert.ok(text.includes(`\n${p}\n  Cache-Control: no-cache\n`), p);
  }
});

test('the file stays inside the Cloudflare limits', () => {
  for (const t of ['staging', 'production']) {
    const text = renderHeadersFile(vercel, t);
    assert.ok(text.split('\n').every((l) => l.length <= 2000));
    assert.ok(text.split('\n\n').length <= 100);
  }
});

test('source patterns: splat, and the narrowed hashed-file regex is flagged', () => {
  assert.deepEqual(vercelSourceToPattern('/(.*)'), { pattern: '/*', narrowed: false });
  assert.deepEqual(vercelSourceToPattern('/_expo/static/(.*)'), { pattern: '/_expo/static/*', narrowed: false });
  assert.equal(vercelSourceToPattern('/assets/(.*\\.[0-9a-f]{32}\\.[A-Za-z0-9]+)').narrowed, true);
  assert.throws(() => vercelSourceToPattern('/plain'));
});

test('routes: the catch-all rewrite is the SPA fallback; regions is reported; no redirects file', () => {
  const r = routesFor(vercel);
  assert.equal(r.spaFallback, true);
  assert.deepEqual(r.untranslated, ['regions: ["bom1"]']);
  assert.equal(renderRedirectsFile(vercel), null);
});

test('redirects: a plain one becomes a line, a conditional one is reported', () => {
  const cfg = { redirects: [{ source: '/old', destination: '/new', permanent: true }, { source: '/x', destination: '/y', has: [{ type: 'host', value: 'a' }] }] };
  assert.equal(renderRedirectsFile(cfg), '/old /new 301\n');
  assert.equal(routesFor(cfg).untranslated.length, 1);
});

test('bad input throws instead of writing a wrong file', () => {
  assert.throws(() => headersFor(vercel, 'prod'));
  assert.throws(() => headersFor({ headers: [] }, 'staging'));
  assert.throws(() => headersFor({ headers: [{ source: '/(.*)', headers: [{ key: 'A', value: 'b' }] }] }, 'production'));
});

test('unhashedAssets finds a mutable file under assets/', () => {
  const hashed = 'assets/a/font.0123456789abcdef0123456789abcdef.ttf';
  assert.deepEqual(unhashedAssets([hashed, 'index.html', 'assets/logo.png']), ['assets/logo.png']);
  // expo-router ships scale variants named <hash>@2x: still hashed. A bare @2x name is not.
  const scaled = 'assets/node_modules/expo-router/assets/clear-icon.c94f6478e7ae0cdd9f15de1fcb9e5e55@2x.png';
  assert.deepEqual(unhashedAssets([scaled, 'assets/icon@2x.png']), ['assets/icon@2x.png']);
});

test('build script: target parsing and env check', () => {
  assert.equal(parseTarget(['--target', 'staging']), 'staging');
  assert.equal(parseTarget(['production', '--dry-run']), 'production');
  assert.equal(exportEnv({ EXPO_PUBLIC_APP_ENV: '' }, 'staging').EXPO_PUBLIC_APP_ENV, 'staging');
  assert.equal('EXPO_PUBLIC_SENTRY_DSN' in exportEnv({ EXPO_PUBLIC_SENTRY_DSN: '' }, 'staging'), false);
  assert.equal(exportEnv({ EXPO_PUBLIC_APP_ENV: 'production' }, 'production').EXPO_PUBLIC_APP_ENV, 'production');
  assert.throws(() => exportEnv({ EXPO_PUBLIC_APP_ENV: 'production' }, 'staging'));
  assert.throws(() => exportEnv({ EXPO_PUBLIC_APP_ENV: 'staging' }, 'production'));
});
