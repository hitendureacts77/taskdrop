// Turns vercel.json (headers, rewrites, redirects) into the files a Cloudflare Worker with static assets reads
// (plan task 5.12): a `_headers` file and, if needed, a `_redirects` file. Pure functions, no file writes;
// scripts/cloudflare-web-build.mjs writes the result into apps/mobile/dist. Tested by scripts/cloudflare-headers.test.mjs.
//
// Cloudflare limits (developers.cloudflare.com/workers/platform/limits): 100 `_headers` rules, 2,000 characters per
// `_headers` line, 2,000 static `_redirects` rules. A rule over a limit throws here, so a bad file is never published.

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
 * Rewrites and redirects. The Vercel catch-all rewrite `/(.*)` -> `/index.html` is the single-page-app fallback in
 * wrangler.*.jsonc (assets.not_found_handling), so it needs no file. A redirect becomes a `_redirects` line; anything
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
  for (const p of perPath) block(p.pattern, p.headers);
  if (blocks.length > MAX_RULES) throw new Error(`_headers has ${blocks.length} rules; Cloudflare allows ${MAX_RULES}.`);
  const text = blocks.join('\n\n') + '\n';
  const long = text.split('\n').find((l) => l.length > MAX_LINE);
  if (long) throw new Error(`A _headers line is ${long.length} characters; Cloudflare allows ${MAX_LINE}.`);
  return text;
}

/** The text of the `_redirects` file, or null when there is nothing to redirect. */
export function renderRedirectsFile(config) {
  const { redirects } = routesFor(config);
  return redirects.length ? redirects.join('\n') + '\n' : null;
}

/** Files under `assets/` whose names are NOT `<name>.<32 hex>.<ext>`: the long-cache rule must not cover them. */
export function unhashedAssets(relativePaths) {
  return relativePaths.filter((p) => p.startsWith('assets/') && !/\.[0-9a-f]{32}\.[A-Za-z0-9]+$/.test(p));
}
