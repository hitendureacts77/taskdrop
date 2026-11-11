#!/usr/bin/env node
/**
 * Gateway-only check: the app may reach its data through our own server and nothing else.
 *
 * The app's one door to the database is the `api` Edge Function (supabase/functions/api), plus a
 * short list of other server functions that each do one job (payments, place search, sign-in,
 * app config). Sign-in itself goes to Supabase Auth, and live updates arrive as private pings
 * (lib/live.ts) that carry no row. Anything else -- a table read with `supabase.from(...)`, a
 * database function called with `.rpc(...)`, a Storage bucket opened from the app, a raw
 * `/rest/v1` address, a table-change subscription -- would go round the gateway: its checks, its
 * rate limits, the admin switches, and the lockdown (supabase/lockdown/gateway_only.sql) that
 * will refuse such requests outright.
 *
 * `npm test` runs this over apps/mobile/src (see check-gateway-only.test.mjs), so a new direct
 * path fails CI before it ships.
 *
 *   node scripts/check-gateway-only.mjs        prints every bypass, exit 1 if there is one
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Server functions the app may call by name. Each one checks the caller itself. */
export const ALLOWED_FUNCTIONS = ['api', 'app-config', 'app-download', 'places-search', 'razorpay', 'password-auth', 'phone-auth'];

/** The one file that makes the Supabase client (sign-in and function calls only). */
const CLIENT_FILE = 'lib/supabase.ts';
/** The one file that subscribes to the private per-person ping channel. */
const LIVE_FILE = 'lib/live.ts';

const RULES = [
  { re: /\bsupabase\s*\.\s*(from|rpc|schema)\s*\(/g, why: (m) => `reads the database directly (supabase.${m[1]})` },
  { re: /\.rpc\s*\(/g, why: () => 'calls a database function directly (.rpc)' },
  { re: /\bsupabase\s*\.\s*storage\b/g, why: () => 'opens Storage directly; ask the api for a signed upload or link' },
  { re: /\/(rest|storage|graphql)\/v1\b/g, why: (m) => `calls the database service address /${m[1]}/v1` },
  { re: /postgres_changes/g, why: () => 'subscribes to raw table changes; use the private pings in lib/live.ts' },
];

/**
 * Every place in one file that goes round the gateway.
 * @param {string} path the file's path under apps/mobile/src, with forward slashes
 * @param {string} text the file's source
 * @returns {{ path: string, line: number, why: string }[]}
 */
export function bypassesIn(path, text) {
  const out = [];
  const at = (index) => text.slice(0, index).split('\n').length;
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) out.push({ path, line: at(m.index), why: rule.why(m) });
  }
  for (const m of text.matchAll(/functions\s*\.\s*invoke\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    if (!ALLOWED_FUNCTIONS.includes(m[1])) out.push({ path, line: at(m.index), why: `calls the function "${m[1]}", which is not on the list` });
  }
  for (const m of text.matchAll(/\/functions\/v1\/([A-Za-z0-9_-]+)/g)) {
    if (!ALLOWED_FUNCTIONS.includes(m[1])) out.push({ path, line: at(m.index), why: `calls the function "${m[1]}", which is not on the list` });
  }
  if (path !== CLIENT_FILE) {
    for (const m of text.matchAll(/\bcreateClient\s*\(/g)) out.push({ path, line: at(m.index), why: `makes its own Supabase client; use ${CLIENT_FILE}` });
  }
  if (path !== LIVE_FILE) {
    for (const m of text.matchAll(/\.channel\s*\(/g)) out.push({ path, line: at(m.index), why: `opens a live channel; only ${LIVE_FILE} may` });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Every bypass in the app's source, tests left out. */
export function scanApp(root) {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx)$/.test(f) && !/\.test\.[jt]sx?$/.test(f)) files.push(p);
    }
  };
  walk(root);
  return files.flatMap((p) => bypassesIn(relative(root, p).split('\\').join('/'), readFileSync(p, 'utf8')));
}

export const APP_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/mobile/src');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = scanApp(APP_SRC);
  for (const b of found) console.log(`${b.path}:${b.line}  ${b.why}`);
  console.log(found.length ? `\n${found.length} request path(s) go round the gateway.` : 'Every request goes through the gateway.');
  process.exit(found.length ? 1 : 0);
}
