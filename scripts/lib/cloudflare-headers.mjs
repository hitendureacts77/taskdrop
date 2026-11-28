// Turns vercel.json (headers, rewrites, redirects) into the files a Cloudflare Worker with static assets reads
// (plan task 5.12): a `_headers` file and, if needed, a `_redirects` file. Pure functions, no file writes;
// scripts/cloudflare-web-build.mjs writes the result into apps/mobile/dist. Tested by scripts/cloudflare-headers.test.mjs.
//
// Cloudflare limits (developers.cloudflare.com/workers/platform/limits): 100 `_headers` rules, 2,000 characters per
// `_headers` line, 2,000 static `_redirects` rules. A rule over a limit throws here, so a bad file is never published.

import { APP_ROUTES, ROUTE_PAGES } from '../../apps/mobile/scripts/web-route-pages.mjs';

export const TARGETS = ['staging', 'production'];

/** CSP sources that only the Vercel toolbar (vercel.live comments) needed. They are dropped on Cloudflare. */
export const VERCEL_TOOLBAR_SOURCES = ['https://vercel.live', 'https://assets.vercel.com', 'wss://ws-us3.pusher.com'];

const MAX_RULES = 100;
const MAX_LINE = 2000;
const NO_CACHE = 'no-cache';

/** Removes the Vercel toolbar sources from a Content-Security-Policy value. */
export function stripVercelToolbar(csp) {
  return csp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...sources] = d.split(/\s+/);
      return [name, ...sources.filter((s) => !VERCEL_TOOLBAR_SOURCES.includes(s))].join(' ');
    })
    .join('; ');
}

const hostOf = (rule) => (rule.has ?? []).find((h) => h.type === 'host')?.value;
const isProductionHost = (rule) => /taskdrop-production/.test(hostOf(rule) ?? '');
const asMap = (rules) => Object.fromEntries(rules.flatMap((r) => r.headers.map((h) => [h.key, h.value])));

/**
 * `/(.*)` -> `/*`; `/_expo/static/(.*)` -> `/_expo/static/*`. A group that is narrower than `.*` (the hashed-file rule
 * `/assets/(.*\.[0-9a-f]{32}\.ext)`) becomes the whole folder and is flagged `narrowed`: `_headers` has no regex.
 */
export function vercelSourceToPattern(source) {
  const m = /^(.*)\/\((.+)\)$/.exec(source);
  if (!m) throw new Error(`Cannot translate the header source "${source}" to a _headers pattern.`);
  return { pattern: `${m[1]}/*`, narrowed: m[2] !== '.*' };
}

/**
 * The headers Cloudflare must send for one site, from a parsed vercel.json.
 * Returns { global: {key: value}, perPath: [{ pattern, headers, narrowed }] }.
 *   staging    = the base headers + X-Robots-Tag (every host rule that sets it), CSP without the Vercel toolbar
 *   production = the base headers with the production CSP (its own Sentry report address), no X-Robots-Tag
 */
export function headersFor(config, target) {
  if (!TARGETS.includes(target)) throw new Error(`target must be one of ${TARGETS.join(', ')}, got "${target}"`);
  const rules = config.headers ?? [];
  const base = rules.filter((r) => r.source === '/(.*)' && !r.has);
  if (base.length === 0) throw new Error('vercel.json has no base header rule for "/(.*)".');
  const global = asMap(base);

  const hostRules = rules.filter((r) => r.has);
  if (target === 'production') {
    const override = asMap(hostRules.filter(isProductionHost));
    if (!override['Content-Security-Policy']) throw new Error('vercel.json has no production Content-Security-Policy rule.');
    Object.assign(global, override);
  } else {
    const noindex = asMap(hostRules.filter((r) => !isProductionHost(r)))['X-Robots-Tag'];
    if (!noindex) throw new Error('vercel.json has no staging X-Robots-Tag rule.');
    global['X-Robots-Tag'] = noindex;
  }
  if (global['Content-Security-Policy']) global['Content-Security-Policy'] = stripVercelToolbar(global['Content-Security-Policy']);

  const perPath = rules
    .filter((r) => !r.has && r.source !== '/(.*)')
    .map((r) => ({ ...vercelSourceToPattern(r.source), headers: asMap([r]) }));
  return { global, perPath };
}

/**
 * Rewrites and redirects. The Vercel catch-all rewrite `/(.*)` -> `/index.html` needs no file on Cloudflare: the
 * public pages are files of their own, the app's screens are rewritten to index.html (APP_ROUTES, renderRedirectsFile)
 * and anything else gets 404.html (wrangler.*.jsonc, not_found_handling "404-page", plan 3.6), where the app shows
 * "Page not found". A redirect becomes a `_redirects` line; anything
 * else is listed in `untranslated` for the build to print.
 */
export function routesFor(config) {
  const redirects = [];
  const untranslated = [];
  let spaFallback = false;
  for (const r of config.rewrites ?? []) {
    if (r.source === '/(.*)' && r.destination === '/index.html' && !r.has) spaFallback = true;
    else untranslated.push(`rewrite ${r.source} -> ${r.destination}`);
  }
  for (const r of config.redirects ?? []) {
    const simple = /^\/[A-Za-z0-9_\-./]*$/.test(r.source) && !r.has && !r.missing;
    if (simple) redirects.push(`${r.source} ${r.destination} ${r.statusCode ?? (r.permanent ? 301 : 302)}`);
    else untranslated.push(`redirect ${r.source} -> ${r.destination}`);
  }
  for (const key of ['regions', 'crons', 'functions', 'cleanUrls', 'trailingSlash']) {
    if (config[key] !== undefined) untranslated.push(`${key}: ${JSON.stringify(config[key])}`);
  }
  return { spaFallback, redirects, untranslated };
}

/** The text of the `_headers` file. */
export function renderHeadersFile(config, target) {
  const { global, perPath } = headersFor(config, target);
  const blocks = [];
  const block = (pattern, headers) => blocks.push([pattern, ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`)].join('\n'));
  block('/*', global);
  // The page itself is never cached for long: a new deploy must be picked up at once. Hashed files below are immutable.
  block('/', { 'Cache-Control': NO_CACHE });
  block('/index.html', { 'Cache-Control': NO_CACHE });
  // The other pages (terms.html, ... and 404.html; plan 3.6) are copies of index.html, so they are never cached either.
  for (const p of ROUTE_PAGES) if (p.path !== '/') block(p.path, { 'Cache-Control': NO_CACHE });
  // The app's screens (/task/*, /wallet, ...) are answered with index.html, so they are never cached either.
  for (const p of APP_ROUTES) block(p, { 'Cache-Control': NO_CACHE });
  block('/404.html', { 'Cache-Control': NO_CACHE });
  for (const p of perPath) block(p.pattern, p.headers);
  if (blocks.length > MAX_RULES) throw new Error(`_headers has ${blocks.length} rules; Cloudflare allows ${MAX_RULES}.`);
  const text = blocks.join('\n\n') + '\n';
  const long = text.split('\n').find((l) => l.length > MAX_LINE);
  if (long) throw new Error(`A _headers line is ${long.length} characters; Cloudflare allows ${MAX_LINE}.`);
  return text;
}

/**
 * The text of the `_redirects` file: vercel.json's redirects first (Cloudflare applies the first rule that matches),
 * then one rewrite per app screen (APP_ROUTES: /task/*, /wallet, ...) to "/" (index.html) with status 200, so a reload or
 * a shared link opens that screen while any other address still gets 404.html with status 404. Not "/index.html":
 * Cloudflare drops that rule as a loop (it redirects /index.html to /; checked with wrangler dev).
 */
export function renderRedirectsFile(config) {
  const { redirects } = routesFor(config);
  const lines = [...redirects, ...APP_ROUTES.map((p) => `${p} / 200`)];
  if (lines.length > 2000) throw new Error(`_redirects has ${lines.length} rules; Cloudflare allows 2000.`);
  return lines.join('\n') + '\n';
}

/**
 * Files under `assets/` whose names are NOT `<name>.<32 hex>.<ext>`: the long-cache rule must not cover them.
 * A scale variant keeps the hash before its suffix (Metro: `icon.<32 hex>@2x.png`), so it counts as hashed.
 */
export function unhashedAssets(relativePaths) {
  return relativePaths.filter((p) => p.startsWith('assets/') && !/\.[0-9a-f]{32}(@\d+(\.\d+)?x)?\.[A-Za-z0-9]+$/.test(p));
}
