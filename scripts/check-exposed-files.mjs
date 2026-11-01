#!/usr/bin/env node
/**
 * Asks every public address for the files that must never be served (task 2.6, "Exposed files"):
 * `/.env`, `/.git/config`, source maps, backups. Each must answer "not found", or at most the
 * app's own front page (these sites send every unknown path to index.html, so a 200 with the
 * normal page is a safe answer; a 200 with anything else is a leak).
 *
 *   node scripts/check-exposed-files.mjs                       the default addresses
 *   node scripts/check-exposed-files.mjs https://a.example ... check these addresses instead
 *
 * Prints only the address, the path and the verdict, never a body. Exit 1 if anything is exposed.
 * Read-only: plain GET requests, no logins, nothing is changed.
 */

export const DEFAULT_ADDRESSES = [
  'https://taskdrop.in',
  'https://www.taskdrop.in',
  'https://taskdrop-five.vercel.app',
  'https://taskdrop-git-redesigned-20-hitenduteam.vercel.app',
];

export const PATHS = [
  '/.env',
  '/.env.local',
  '/.env.production',
  '/.env.all-secrets',
  '/.git/config',
  '/.git/HEAD',
  '/.gitignore',
  '/package.json',
  '/package-lock.json',
  '/vercel.json',
  '/supabase/config.toml',
  '/google-services.json',
  '/backup.sql',
  '/backup.zip',
  '/db.sql',
  '/dump.sql',
  '/index.html.bak',
  '/_expo/static/js/web/entry.js.map',
  '/_next/static/chunks/main.js.map',
  '/static/js/main.js.map',
  '/sourcemaps/',
];

/**
 * @param {number} status @param {string} contentType @param {string} body
 * @param {string} homeBody the body of the front page, which unknown paths fall back to
 * @returns {'not found' | 'front page' | 'EXPOSED'}
 */
export function verdict(status, contentType, body, homeBody) {
  if (status === 404 || status === 410 || status === 403 || status === 401 || status === 400) return 'not found';
  if (status >= 300 && status < 400) return 'not found'; // a redirect (to the front page or to sign-in) serves no file
  if (status !== 200) return 'not found';
  if (/html/i.test(contentType) && looksLikeFrontPage(body, homeBody)) return 'front page';
  return 'EXPOSED';
}

function looksLikeFrontPage(body, homeBody) {
  if (body === homeBody) return true;
  // The admin panel and the Next.js sites render a normal HTML page for unknown paths.
  return /^\s*<!doctype html/i.test(body) && !/(^|\n)[A-Z][A-Z0-9_]{3,}=\S/.test(body) && !/\[core\]|\[remote "origin"\]/.test(body);
}

async function get(url) {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  const text = (await res.text()).slice(0, 200_000);
  return { status: res.status, type: res.headers.get('content-type') ?? '', text };
}

export async function checkAddress(base) {
  const home = await get(base + '/');
  const out = [];
  for (const path of PATHS) {
    let r;
    try {
      r = await get(base + path);
    } catch (e) {
      out.push({ path, verdict: `error (${e.message})` });
      continue;
    }
    out.push({ path, verdict: verdict(r.status, r.type, r.text, home.text) });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const addresses = args.length ? args : DEFAULT_ADDRESSES;
  let bad = 0;
  for (const base of addresses) {
    let results;
    try {
      results = await checkAddress(base);
    } catch (e) {
      console.log(`${base}: could not be reached (${e.message})`);
      bad++;
      continue;
    }
    const exposed = results.filter((r) => r.verdict === 'EXPOSED' || r.verdict.startsWith('error'));
    bad += exposed.length;
    console.log(`${base}: ${exposed.length === 0 ? `ok, ${results.length} paths checked, none served` : `${exposed.length} PROBLEM(S)`}`);
    for (const r of exposed) console.log(`  ${r.path}: ${r.verdict}`);
  }
  if (bad) process.exit(1);
}

if (process.argv[1]?.endsWith('check-exposed-files.mjs')) await main();
