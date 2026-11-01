// Tests for the commit guard and for the rule that no secret reaches the app.
// Run from the repo root: node --test scripts/secret-guard.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { forbiddenFile, scanText } from './lib/secret-patterns.mjs';
import { scanFiles } from './secret-guard.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ls = () => execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);

// Built at run time so this file itself holds no secret-shaped text.
const fakeJwt = (role) =>
  ['{"alg":"HS256"}', JSON.stringify({ role })].map((p) => Buffer.from(p).toString('base64url')).join('.') + '.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
const long = (n) => 'a1B2c3D4'.repeat(Math.ceil(n / 8)).slice(0, n);

test('catches the kinds of secret we hold', () => {
  const cases = {
    'private-key-block': '-----BEGIN ' + 'PRIVATE KEY-----',
    'razorpay-live-key': 'k = "rzp_live_' + long(14) + '"',
    'aws-access-key-id': 'AKIA' + 'ABCDEFGHIJKLMNOP',
    'github-token': 'ghp_' + long(36),
    'supabase-service-role-jwt': 'x=' + fakeJwt('service_role'),
    'secret-assignment': 'const CLIENT_SECRET = "' + long(32) + '";',
  };
  for (const [rule, line] of Object.entries(cases)) {
    assert.deepEqual(scanText(line).map((h) => h.rule), [rule], rule);
  }
});

test('lets safe text through', () => {
  assert.deepEqual(scanText('const k = "rzp_live_THROWAWAYKEY01";'), []);
  assert.deepEqual(scanText('x=' + fakeJwt('anon')), []);
  assert.deepEqual(scanText('SECRET_KEYS="EXPO_GOOGLE_MAPS_API_KEY"'), []);
  assert.deepEqual(scanText('RAZORPAY_KEY_ID=rzp_live_...'), []);
  assert.deepEqual(scanText('const CLIENT_SECRET = "' + long(32) + '"; // secret-guard: allow'), []);
});

test('findings never contain the secret', () => {
  const secret = 'rzp_live_' + long(14);
  assert.ok(!JSON.stringify(scanText(secret)).includes(secret));
});

test('files that must never be committed', () => {
  for (const f of ['.env', '.env.local', '.env.all-secrets', 'a/b/.env.production', 'x.keystore', 'a.jks', 'google-services.json', 'backup.7z']) {
    assert.equal(forbiddenFile(f), true, f);
  }
  for (const f of ['.env.example', 'src/env.ts', 'docs/keystore.md']) assert.equal(forbiddenFile(f), false, f);
});

test('scanFiles reports file and line, and skips unreadable files', () => {
  const files = { 'a.ts': 'ok\nk="rzp_live_' + long(14) + '"', '.env': 'A=1' };
  const out = scanFiles(['a.ts', '.env', 'gone.ts'], (f) => {
    if (!(f in files)) throw new Error('missing');
    return files[f];
  });
  assert.equal(out.length, 2);
  assert.match(out[0], /^a\.ts:2: .*razorpay-live-key/);
  assert.match(out[1], /^\.env: /);
});

test('every tracked file passes the guard', () => {
  const problems = scanFiles(ls(), (f) => readFileSync(join(root, f), 'utf8'));
  assert.deepEqual(problems, []);
});

test('the fake Razorpay keys in tests are made up, not real', () => {
  const seen = [];
  for (const f of ls().filter((f) => /\.test\.(ts|mjs|js)$/.test(f))) {
    if (f.endsWith('secret-guard.test.mjs')) continue;
    for (const m of readFileSync(join(root, f), 'utf8').matchAll(/rzp_(?:live|test)_[A-Za-z0-9]{10,}/g)) seen.push(`${f}: ${m[0]}`);
  }
  assert.ok(seen.length > 0, 'expected the keyMode test to hold two fake keys');
  for (const s of seen) assert.match(s, /THROWAWAY/, `${s.split(':')[0]} holds a Razorpay key that is not marked THROWAWAY`);
});

// ---- nothing secret in the website or the Android app ------------------------------------------

/** Names that must never be readable by the app: they would be baked into the bundle. */
const SERVER_ONLY = /SERVICE_ROLE|RAZORPAY(X)?_(KEY_)?SECRET|WEBHOOK_SECRET|PRIVATE_KEY|API_GATEWAY_SECRET|ADMIN_SESSION_SECRET|SUPABASE_ACCESS_TOKEN|DATABASE_URL|AUTH_TOKEN|MSG91|CASHFREE|INNGEST_(SIGNING|EVENT)_KEY|OMNIROUTE|KEYSTORE|PASSWORD/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.expo', 'build', '.turbo', 'ios', 'android'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|json)$/.test(name)) out.push(p);
  }
  return out;
}

test('the app reads only public environment names', () => {
  const bad = [];
  for (const f of walk(join(root, 'apps/mobile'))) {
    const text = readFileSync(f, 'utf8');
    // EXPO_PUBLIC_ names are copied into the bundle: none may sound like a secret.
    for (const m of text.matchAll(/EXPO_PUBLIC_[A-Z0-9_]+/g)) {
      if (SERVER_ONLY.test(m[0])) bad.push(`${relative(root, f)}: ${m[0]}`);
    }
    // A client file must not read a server-only name at all.
    if (/[\/]src[\/]/.test(f)) {
      for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        if (SERVER_ONLY.test(m[1])) bad.push(`${relative(root, f)}: process.env.${m[1]}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('eas.json and .env.example expose only public values to the app', () => {
  const bad = [];
  const eas = JSON.parse(readFileSync(join(root, 'apps/mobile/eas.json'), 'utf8'));
  const scan = (o, path) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      if (v && typeof v === 'object') scan(v, `${path}.${k}`);
      else if (k.startsWith('EXPO_PUBLIC_') && SERVER_ONLY.test(k)) bad.push(`eas.json ${path}.${k}`);
    }
  };
  scan(eas, 'eas');
  for (const f of ['.env.example', 'apps/mobile/.env.example']) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, 'utf8').matchAll(/^(EXPO_PUBLIC_[A-Z0-9_]+)=/gm)) if (SERVER_ONLY.test(m[1])) bad.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(bad, []);
});

test('a built web bundle (when one exists) holds no secret', () => {
  const dist = join(root, 'apps/mobile/dist');
  if (!existsSync(dist)) return; // CI builds the web app in another job; here the check runs when a build is present
  const hits = [];
  const walkAll = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walkAll(p);
      else if (/\.(js|html|json|map)$/.test(name)) {
        // Minified bundles are one huge line, so scan in slices.
        const text = readFileSync(p, 'utf8');
        for (let i = 0; i < text.length; i += 3000) {
          for (const h of scanText(text.slice(Math.max(0, i - 200), i + 3000))) hits.push(`${relative(dist, p)}: ${h.rule}`);
        }
      }
    }
  };
  walkAll(dist);
  assert.deepEqual([...new Set(hits)], []);
});
