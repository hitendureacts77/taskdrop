#!/usr/bin/env node
/**
 * Builds the user web app for Cloudflare Workers static assets (plan task 5.12, steps 4-5).
 * Called by .github/workflows/web-deploy.yml; the upload is `npx wrangler deploy --config wrangler.<target>.jsonc`.
 *
 *   node scripts/cloudflare-web-build.mjs --target staging|production [--dry-run] [--headers-only]
 *   node scripts/cloudflare-web-build.mjs staging                      (the target may also be the first argument)
 *
 * It does what scripts/vercel-build.mjs does for the web part, then adds the Cloudflare files:
 *   1. web export           npm run web:export   (expo export + scripts/web-env-guard.mjs: noindex + robots.txt on staging)
 *   2. scan the build       scripts/scan-build.mjs apps/mobile/dist   (a key in the bundle stops the build)
 *   3. Sentry source maps   scripts/upload-web-sourcemaps.mjs; skipped when the token is absent; the .map files are
 *                           deleted either way and the build fails if one is left
 *   4. _headers and _redirects written into apps/mobile/dist, from vercel.json and the app's screen addresses
 *
 * The site (staging or production) is chosen by --target; EXPO_PUBLIC_APP_ENV must agree with it (empty = taken from
 * the target; "production" on a staging build, or the reverse, stops the build). Backend steps (migrations, Edge
 * Functions) are NOT here: they stay in the Vercel build and the production-database workflow.
 *
 * --dry-run prints the steps and the _headers text and runs nothing. --headers-only writes only the Cloudflare
 * files into an existing build.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHeadersFile, renderRedirectsFile, routesFor, TARGETS, unhashedAssets } from './lib/cloudflare-headers.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(repo, 'apps', 'mobile', 'dist');

const note = (m) => console.log(`[cloudflare-web-build] ${m}`);
const warn = (m) => console.log(`::warning:: [cloudflare-web-build] ${m}`);
const fail = (m) => {
  console.error(`[cloudflare-web-build] FAILED: ${m}`);
  process.exit(1);
};

function listFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

/** The --target value, or the first bare argument. */
export function parseTarget(argv) {
  const i = argv.indexOf('--target');
  const value = i >= 0 ? argv[i + 1] : argv.find((a) => !a.startsWith('--'));
  return value;
}

/** The environment for the export: empty EXPO_PUBLIC_ and APP_VARIANT values (an unset GitHub secret) are removed, APP_ENV is checked against the target. */
export function exportEnv(env, target) {
  const out = { ...env };
  for (const k of Object.keys(out)) if ((k.startsWith('EXPO_PUBLIC_') || k === 'APP_VARIANT') && out[k] === '') delete out[k];
  const appEnv = (out.EXPO_PUBLIC_APP_ENV ?? '').trim().toLowerCase();
  if (!appEnv) out.EXPO_PUBLIC_APP_ENV = target;
  else if ((appEnv === 'production') !== (target === 'production')) {
    throw new Error(`EXPO_PUBLIC_APP_ENV is "${appEnv}" but the target is ${target}. A staging build must not carry the production setting, or the reverse.`);
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const headersOnly = argv.includes('--headers-only');
  const target = parseTarget(argv);
  if (!TARGETS.includes(target)) fail(`give --target ${TARGETS.join('|')} (got "${target ?? ''}")`);

  let env;
  try {
    env = exportEnv(process.env, target);
  } catch (e) {
    fail(e.message);
  }

  const run = (label, cmd, args) => {
    note(`${label}: ${cmd} ${args.join(' ')}`);
    if (dryRun) return true;
    return spawnSync(cmd, args, { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32', env }).status === 0;
  };

  if (!headersOnly) {
    if (!run('web export', 'npm', ['run', 'web:export'])) fail('web export. Nothing was published.');
    if (!run('scan the web build for secrets', 'node', ['scripts/scan-build.mjs', 'apps/mobile/dist'])) fail('the build scan found a problem. Nothing was published.');

    // The upload script deletes every .map file whether or not it uploads, so it always runs. No token = skipped, not an error.
    const hasToken = Boolean(env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN_TASKDROP_USERAPP);
    const ok = run('web source maps', 'node', ['scripts/upload-web-sourcemaps.mjs']);
    if (!hasToken) note('Sentry token not set: source maps not uploaded (removed from the build).');
    else if (!ok) warn('Web source maps were not uploaded; web errors in Sentry will show minified stacks.');
  }

  const config = JSON.parse(readFileSync(join(repo, 'vercel.json'), 'utf8'));
  const headers = renderHeadersFile(config, target);
  const redirects = renderRedirectsFile(config);
  const routes = routesFor(config);
  if (!routes.spaFallback) warn('vercel.json has no catch-all rewrite to /index.html, so the single-page fallback in wrangler.*.jsonc is the only routing.');
  for (const u of routes.untranslated) note(`not translated to Cloudflare: ${u}`);

  if (dryRun) {
    note(`would write dist/_headers for ${target}:\n${headers}`);
    return;
  }
  if (!existsSync(join(DIST, 'index.html'))) fail('apps/mobile/dist/index.html is missing: nothing to publish.');
  const files = listFiles(DIST).map((p) => relative(DIST, p).split('\\').join('/'));
  const maps = files.filter((f) => f.endsWith('.map'));
  if (maps.length) fail(`${maps.length} .map file(s) are still in the build; they must never be published.`);
  const loose = unhashedAssets(files);
  if (loose.length) fail(`the long-cache rule covers /assets/*, but ${loose.length} file(s) there are not hashed (first: ${loose[0]}).`);

  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, '_headers'), headers);
  if (redirects) writeFileSync(join(DIST, '_redirects'), redirects);
  note(`wrote dist/_headers${redirects ? ' and dist/_redirects' : ''} for ${target}; ${files.length} files ready for wrangler deploy --config wrangler.${target}.jsonc`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
