#!/usr/bin/env node
/**
 * One HTML file per website address, so each page has its own title and description in the raw page
 * (plan task 3.6, T13 points 5, 6 and 8). Runs after web-env-guard.mjs in the `web:export` script.
 *
 * The website is one app (dist/index.html). Each file written here is a copy of that page with only its
 * <title> and description changed, so Google and link previews read the right words before the app loads:
 *   /terms, /privacy, /support, /copyright, /get   -> dist/<name>.html (Cloudflare serves /terms from terms.html)
 *   any other address                              -> dist/404.html, "Page not found", never indexed
 * dist/index.html itself gets the Home title and description.
 *
 * On Cloudflare (wrangler.*.jsonc, not_found_handling "404-page") an address with no file gets 404.html with
 * status 404, and the app shows its own "Page not found" screen (src/components/NotFound.tsx). The list of real
 * addresses must match KNOWN_PATHS in src/navigation/webAddress.ts (web-route-pages.test.mjs checks it).
 *
 *   node apps/mobile/scripts/web-route-pages.mjs [distFolder]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every address with a page of its own. `file` is under dist/. Titles match titleForScreen in webAddress.ts. */
export const ROUTE_PAGES = [
  {
    path: '/',
    file: 'index.html',
    title: 'TaskDrop · Ask for anything. Someone gets it done for you.',
    description: 'Post a task in your area, from repairs and errands to one-off jobs, and a local helper gets it done. Pay safely once the work is done.',
  },
  {
    path: '/terms',
    file: 'terms.html',
    title: 'Terms of Service · TaskDrop',
    description: 'The rules for using TaskDrop: posting tasks, doing them, payments, refunds, cancellations and what each side agrees to.',
  },
  {
    path: '/privacy',
    file: 'privacy.html',
    title: 'Privacy Policy · TaskDrop',
    description: 'What TaskDrop collects, why, how long it is kept, who it is shared with, and how to see, correct or delete your data.',
  },
  {
    path: '/support',
    file: 'support.html',
    title: 'Help and support · TaskDrop',
    description: 'Get help with a task, a payment or your account, report a problem or a safety concern, and reach the TaskDrop grievance officer.',
  },
  {
    path: '/copyright',
    file: 'copyright.html',
    title: 'Copyright · TaskDrop',
    description: 'Who owns the words, pictures and code on TaskDrop, and how to report content that copies your work.',
  },
  {
    path: '/get',
    file: 'get.html',
    title: 'Get TaskDrop for Android',
    description: 'Download the TaskDrop app for Android: post tasks, find work near you and get alerts the moment someone answers.',
  },
];

/**
 * The app's own screens (board fix "Back, refresh and links"): no file each, Cloudflare answers them with
 * index.html through a `_redirects` rewrite (scripts/lib/cloudflare-headers.mjs) and the app opens the screen.
 * Ids only, never anything personal. Must match APP_ROUTE_PATTERNS in src/navigation/webAddress.ts
 * (web-route-pages.test.mjs checks). Vercel already sends every address to index.html (vercel.json).
 */
export const APP_ROUTES = [
  '/find-work',
  '/explore',
  '/map',
  '/my-tasks',
  '/my-work',
  '/wallet',
  '/messages',
  '/notifications',
  '/profile',
  '/account',
  '/post',
  '/saved',
  '/help',
  '/ideas',
  '/task/*',
  '/profile/*',
];

/** What any address without a page gets. */
export const NOT_FOUND_PAGE = {
  file: '404.html',
  title: 'Page not found · TaskDrop',
  description: 'This address does not lead anywhere on TaskDrop. Go to Home, or open Help and support.',
};

const ROBOTS_RE = /<meta\s+name="robots"[^>]*>/gi;
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The app page with this title and description. Any description tag already there is replaced; one is added
 * when there is none. `noindex` replaces any robots tag with a plain noindex (the 404 page).
 */
export function pageHtml(indexHtml, { title, description }, { noindex = false } = {}) {
  if (!/<\/head>/i.test(indexHtml)) throw new Error('index.html has no </head>');
  let html = indexHtml;
  const titleTag = `<title>${escapeHtml(title)}</title>`;
  html = /<title>[\s\S]*?<\/title>/i.test(html) ? html.replace(/<title>[\s\S]*?<\/title>/i, titleTag) : html.replace(/<\/head>/i, `${titleTag}</head>`);
  const descTag = `<meta name="description" content="${escapeHtml(description)}">`;
  const descRe = /<meta\s+name="description"[^>]*>/i;
  html = descRe.test(html) ? html.replace(descRe, descTag) : html.replace(/<\/head>/i, `${descTag}</head>`);
  if (noindex) html = html.replace(ROBOTS_RE, '').replace(/<\/head>/i, '<meta name="robots" content="noindex"></head>');
  return html;
}

/** Writes every page into `dist` from its index.html. Returns the files written. */
export function run(dist) {
  const indexFile = join(dist, 'index.html');
  if (!existsSync(indexFile)) throw new Error(`${indexFile} not found; run expo export first`);
  const base = readFileSync(indexFile, 'utf8');
  const written = [];
  for (const p of ROUTE_PAGES) {
    writeFileSync(join(dist, p.file), pageHtml(base, p));
    written.push(p.file);
  }
  writeFileSync(join(dist, NOT_FOUND_PAGE.file), pageHtml(base, NOT_FOUND_PAGE, { noindex: true }));
  written.push(NOT_FOUND_PAGE.file);
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
  const files = run(dist);
  console.log(`[web-route-pages] wrote ${files.join(', ')}`);
}
