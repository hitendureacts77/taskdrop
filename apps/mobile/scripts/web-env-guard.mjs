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
 *   node apps/mobile/scripts/web-env-guard.mjs [distFolder]
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOINDEX_META = '<meta name="robots" content="noindex, nofollow">';
export const ROBOTS_TXT = '# Staging copy of TaskDrop: not for search engines.\nUser-agent: *\nDisallow: /\n';

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

export function run(dist, env) {
  const production = isProductionBuild(env);
  const indexFile = join(dist, 'index.html');
  const robotsFile = join(dist, 'robots.txt');
  if (!existsSync(indexFile)) throw new Error(`${indexFile} not found; run expo export first`);
  writeFileSync(indexFile, applyToHtml(readFileSync(indexFile, 'utf8'), production));
  if (production) rmSync(robotsFile, { force: true });
  else writeFileSync(robotsFile, ROBOTS_TXT);
  return production ? 'production' : 'staging';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
  console.log(`[web-env-guard] ${run(dist, process.env.EXPO_PUBLIC_APP_ENV)} build: ${dist}`);
}
