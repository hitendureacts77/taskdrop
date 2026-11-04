#!/usr/bin/env node
/**
 * Every server function has a lock and a limit, or a written reason (task 2.13 part A).
 *
 * Each folder in supabase/functions is a door anyone on the internet can knock on. This lists
 * them and puts each in one of four kinds. A function on none of them fails `npm test`, so a new
 * door cannot be merged until somebody decides what protects it:
 *
 *   login       checks the signed-in caller AND counts a hit per person (the shared limiter)
 *   own-limits  public because it is how people sign in; limits by phone number and network address
 *   signature   public because a provider calls it; checks the provider's signature or signing key
 *   public      open on purpose, with the reason written below
 *
 *   node scripts/check-endpoints.mjs      prints every problem, exit 1 if there is one
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {Record<string, { kind: 'login' | 'own-limits' | 'signature' | 'public', why?: string }>} */
export const FUNCTIONS = {
  api: { kind: 'login' },
  razorpay: { kind: 'login' },
  'razorpayx-payouts': { kind: 'login' },
  'places-search': { kind: 'login' },
  'phone-auth': { kind: 'own-limits' },
  'password-auth': { kind: 'own-limits' },
  'razorpay-webhook': { kind: 'signature' },
  'razorpayx-webhook': { kind: 'signature' },
  inngest: { kind: 'signature' },
  'app-config': { kind: 'public', why: 'tells the app what the admin switched (maintenance, minimum version, banner); read before sign-in and holds nothing secret' },
};

const LOGIN = /\bauth\s*\.\s*(getUser|getClaims)\s*\(/;
const LIMIT = /_shared\/rateLimit|\bapi_rate_(hit|spend)\b|\btake_places_quota\b/;
const OWN_LIMIT = /\bhit_auth_send_ip\b|\bpassword_sign_in_gate\b/;
const SIGNATURE = /x-razorpay-signature|INNGEST_SIGNING_KEY|handleWebhook\s*\(/;

/**
 * Problems with one function.
 * @param {string} name the folder name
 * @param {string} text all of the function's own source, joined
 * @param {string} config the text of supabase/config.toml
 */
export function problemsFor(name, text, config) {
  const door = FUNCTIONS[name];
  if (!door) return [`${name}: is not on the list in scripts/check-endpoints.mjs. Add it as login, own-limits, signature or public (with a reason)`];
  const out = [];
  const publicInConfig = new RegExp(`\\[functions\\.${name}\\][^\\[]*verify_jwt\\s*=\\s*false`).test(config);
  if (door.kind === 'login') {
    if (!LOGIN.test(text)) out.push(`${name}: no check of the signed-in caller (auth.getUser / getClaims)`);
    if (!LIMIT.test(text)) out.push(`${name}: no per-person limit (use _shared/rateLimit.ts)`);
    if (publicInConfig) out.push(`${name}: marked verify_jwt = false in supabase/config.toml but listed as login`);
  } else if (door.kind === 'own-limits') {
    if (!OWN_LIMIT.test(text)) out.push(`${name}: no limit by phone number or network address`);
  } else if (door.kind === 'signature') {
    if (!SIGNATURE.test(text)) out.push(`${name}: no check of the provider's signature or signing key`);
  } else if (!door.why) {
    out.push(`${name}: marked public with no reason`);
  }
  return out;
}

const SOURCE = /\.(ts|tsx|js|mjs)$/;
const TEST = /\.test\.[jt]s$/;

/** One function's own source files, tests left out, joined. */
export function functionText(dir) {
  const parts = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (SOURCE.test(f) && !TEST.test(f)) parts.push(readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return parts.join('\n');
}

/** Problems across every function folder, including a listed one that no longer exists. */
export function scanFunctions(functionsDir, config) {
  const names = readdirSync(functionsDir).filter((n) => !n.startsWith('_') && statSync(join(functionsDir, n)).isDirectory());
  const out = names.flatMap((n) => problemsFor(n, functionText(join(functionsDir, n)), config));
  for (const n of Object.keys(FUNCTIONS)) {
    if (!names.includes(n)) out.push(`${n}: is on the list but the function no longer exists. Remove it from scripts/check-endpoints.mjs`);
  }
  return out;
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const FUNCTIONS_DIR = resolve(HERE, '../supabase/functions');
export const CONFIG_FILE = resolve(HERE, '../supabase/config.toml');
export const readConfig = () => (existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, 'utf8') : '');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = scanFunctions(FUNCTIONS_DIR, readConfig());
  for (const p of problems) console.log(p);
  console.log(problems.length ? `\n${problems.length} problem(s).` : 'Every server function has a lock and a limit, or a written reason.');
  process.exit(problems.length ? 1 : 0);
}
