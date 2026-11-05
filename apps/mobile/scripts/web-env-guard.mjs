#!/usr/bin/env node
/**
 * Keeps search engines out of the staging website. Runs after `expo export`
 * (see the `web:export` script) and edits the finished build in apps/mobile/dist.
 *
 * Which build is it? EXPO_PUBLIC_APP_ENV, read at build time:
 *   unset or anything but "production"  -> staging: dist/robots.txt blocks every crawler and
 *                                          dist/index.html gets <meta name="robots" content="noindex, nofollow">
 *   "production"                        -> nothing is added, and any noindex left in the build is taken out
 *
 * Staging is the default on purpose: a build that forgets the flag stays hidden from search engines,
 * and a production build has to say so. The Vercel project that serves production sets
 * EXPO_PUBLIC_APP_ENV=production (docs/UPGRADE_PLAN.md, Phase 10). The matching X-Robots-Tag header
 * lives in vercel.json, scoped to the staging hosts, because Vercel's header rules cannot read an
 * environment variable.
 *
 * It also writes /.well-known/security.txt (RFC 9116, task 2.13 part D) so a security researcher knows where to
 * report a problem. The contact is the support address the Support page shows (EXPO_PUBLIC_LEGAL_EMAIL, decision 14),
 * plus the Support page itself, which holds the rules. Both builds get the file.
 *
 *   node apps/mobile/scripts/web-env-guard.mjs [distFolder]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOINDEX_META = '<meta name="robots" content="noindex, nofollow">';
export const ROBOTS_TXT = '# Staging copy of TaskDrop: not for search engines.\nUser-agent: *\nDisallow: /\n';

/**
 * When security.txt stops being valid (RFC 9116 wants an expiry). A build refuses to ship an expired
 * file; the monthly security check reminds the owner a month ahead ("renew security.txt" = Claude moves
 * this date one year on).
 */
export const SECURITY_TXT_EXPIRES = '2027-10-31T00:00:00.000Z';
export const DEFAULT_ORIGIN = 'https://taskdrop.in';
export const SUPPORT_URL = `${DEFAULT_ORIGIN}/?page=support`;

/**
 * The address this build is served from: EXPO_PUBLIC_APP_URL, so the production site names its own address
 * (plan task 5.10) and not staging's. Unset means taskdrop.in, which is staging's.
 */
export function originOf(raw = process.env.EXPO_PUBLIC_APP_URL) {
  const v = String(raw ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+$/.test(v) ? v : DEFAULT_ORIGIN;
}

/** The text of /.well-known/security.txt. `email` is the Support address, or empty when none is set yet. */
export function securityTxt(email, now = new Date(), origin = DEFAULT_ORIGIN) {
  if (now.getTime() >= Date.parse(SECURITY_TXT_EXPIRES)) {
    throw new Error('security.txt has expired: move SECURITY_TXT_EXPIRES in apps/mobile/scripts/web-env-guard.mjs one year on');
  }
  const address = String(email ?? '').trim();
  const lines = [];
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) lines.push(`Contact: mailto:${address}`);
  const support = `${origin}/?page=support`;
  lines.push(`Contact: ${support}`);
  lines.push(`Expires: ${SECURITY_TXT_EXPIRES}`);
  lines.push('Preferred-Languages: en');
  lines.push(`Canonical: ${origin}/.well-known/security.txt`);
  lines.push(`Policy: ${support}`);
  return `${lines.join('\n')}\n`;
}

const META_RE = /<meta name="robots" content="noindex, nofollow">/g;

/** Only a clear "production" is production; a missing or odd value is staging. */
export function isProductionBuild(env = process.env.EXPO_PUBLIC_APP_ENV) {
  return String(env ?? '').trim().toLowerCase() === 'production';
}

/** The page with the noindex tag in its <head> exactly once (staging), or without it (production). */
export function applyToHtml(html, production) {
  const clean = html.replace(META_RE, '');
  if (production) return clean;
  if (!/<\/head>/i.test(clean)) throw new Error('index.html has no </head>; cannot add the noindex tag');
  return clean.replace(/<\/head>/i, `${NOINDEX_META}</head>`);
}

export function run(dist, env, email = process.env.EXPO_PUBLIC_LEGAL_EMAIL, origin = originOf()) {
  const production = isProductionBuild(env);
  const indexFile = join(dist, 'index.html');
  const robotsFile = join(dist, 'robots.txt');
  if (!existsSync(indexFile)) throw new Error(`${indexFile} not found; run expo export first`);
  writeFileSync(indexFile, applyToHtml(readFileSync(indexFile, 'utf8'), production));
  if (production) rmSync(robotsFile, { force: true });
  else writeFileSync(robotsFile, ROBOTS_TXT);
  mkdirSync(join(dist, '.well-known'), { recursive: true });
  writeFileSync(join(dist, '.well-known', 'security.txt'), securityTxt(email, new Date(), origin));
  return production ? 'production' : 'staging';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
  console.log(`[web-env-guard] ${run(dist, process.env.EXPO_PUBLIC_APP_ENV)} build: ${dist}`);
}
