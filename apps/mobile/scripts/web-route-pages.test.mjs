// Tests for the per-address pages of the website (plan 3.6, T13 points 5, 6 and 8).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { APP_ROUTES, NOT_FOUND_PAGE, pageHtml, ROUTE_PAGES, run } from './web-route-pages.mjs';
import { APP_ROUTE_PATTERNS, isKnownPath, KNOWN_PATHS, NOT_FOUND_TITLE, SITE_TITLE, titleForScreen } from '../src/navigation/webAddress.ts';

const INDEX = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>TaskDrop</title><meta name="description" content="Ask for anything."><meta name="robots" content="noindex, nofollow"></head><body><div id="root"></div><script src="/_expo/static/js/web/entry-abc.js" defer></script></body></html>';

test('the app screen addresses served on Cloudflare match the app, and the app answers each one', () => {
  assert.deepEqual([...APP_ROUTES].sort(), [...APP_ROUTE_PATTERNS].sort());
  for (const p of APP_ROUTES) assert.equal(isKnownPath(p.replace('*', '0b7c1f3e-2d4a-4c8b-9e6f-1a2b3c4d5e6f')), true, p);
});

test('the pages cover exactly the addresses the app knows', () => {
  assert.deepEqual(ROUTE_PAGES.map((p) => p.path).sort(), [...KNOWN_PATHS].sort());
});

test('each page title matches the tab title the app sets once it loads', () => {
  for (const p of ROUTE_PAGES) {
    const screen = p.path.slice(1);
    const expected = p.path === '/' ? SITE_TITLE : p.path === '/get' ? 'Get TaskDrop for Android' : titleForScreen(screen);
    assert.equal(p.title, expected, p.path);
  }
  assert.equal(NOT_FOUND_PAGE.title, NOT_FOUND_TITLE);
});

test('titles and descriptions are their own, and short enough for search results', () => {
  const all = [...ROUTE_PAGES, NOT_FOUND_PAGE];
  assert.equal(new Set(all.map((p) => p.title)).size, all.length);
  assert.equal(new Set(all.map((p) => p.description)).size, all.length);
  for (const p of all) {
    assert.ok(p.title.length <= 65, `${p.file} title is ${p.title.length} characters`);
    assert.ok(p.description.length >= 70 && p.description.length <= 160, `${p.file} description is ${p.description.length} characters`);
    assert.doesNotMatch(p.title, /^TaskDrop$/);
  }
});

test('pageHtml swaps the title and description and keeps everything else', () => {
  const out = pageHtml(INDEX, { title: 'Terms of Service · TaskDrop', description: 'Rules & "quotes" <here>' });
  assert.match(out, /<title>Terms of Service · TaskDrop<\/title>/);
  assert.match(out, /<meta name="description" content="Rules &amp; &quot;quotes&quot; &lt;here&gt;">/);
  assert.equal((out.match(/<title>/g) ?? []).length, 1);
  assert.equal((out.match(/name="description"/g) ?? []).length, 1);
  assert.match(out, /noindex, nofollow/); // the staging tag from web-env-guard stays
  assert.match(out, /entry-abc\.js/);
});

test('pageHtml adds a title and description when the page has none', () => {
  const out = pageHtml('<html><head></head><body></body></html>', { title: 'A', description: 'B' });
  assert.match(out, /<title>A<\/title><meta name="description" content="B"><\/head>/);
  assert.throws(() => pageHtml('<html></html>', { title: 'A', description: 'B' }), /no <\/head>/);
});

test('the 404 page is always noindex, with one robots tag', () => {
  const out = pageHtml(INDEX, NOT_FOUND_PAGE, { noindex: true });
  assert.equal((out.match(/name="robots"/g) ?? []).length, 1);
  assert.match(out, /<meta name="robots" content="noindex">/);
  assert.match(out, /<title>Page not found · TaskDrop<\/title>/);
});

test('run writes every page next to index.html', () => {
  const dir = mkdtempSync(join(tmpdir(), 'route-pages-'));
  try {
    writeFileSync(join(dir, 'index.html'), INDEX);
    const files = run(dir);
    assert.deepEqual(files.sort(), ['404.html', 'copyright.html', 'get.html', 'index.html', 'privacy.html', 'support.html', 'terms.html']);
    assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), new RegExp(`<title>${SITE_TITLE}</title>`));
    assert.match(readFileSync(join(dir, 'privacy.html'), 'utf8'), /<title>Privacy Policy · TaskDrop<\/title>/);
    // Running twice (the build re-run) changes nothing.
    run(dir);
    assert.equal((readFileSync(join(dir, '404.html'), 'utf8').match(/name="robots"/g) ?? []).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
