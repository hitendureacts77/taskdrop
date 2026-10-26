// Tests for the staging noindex step. Run from the repo root:
//   node --test scripts/web-env-guard.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyToHtml, isProductionBuild, NOINDEX_META, ROBOTS_TXT, run } from '../apps/mobile/scripts/web-env-guard.mjs';

const HTML = '<!DOCTYPE html><html><head><title>TaskDrop</title></head><body></body></html>';

test('only "production" is production; unset or odd values are staging', () => {
  assert.equal(isProductionBuild('production'), true);
  assert.equal(isProductionBuild(' Production '), true);
  for (const v of [undefined, '', 'staging', 'prod', 'alpha', 'true']) assert.equal(isProductionBuild(v), false);
});

test('staging adds noindex once, even if run twice', () => {
  const once = applyToHtml(HTML, false);
  assert.ok(once.includes(`${NOINDEX_META}</head>`));
  assert.equal(applyToHtml(once, false), once);
});

test('production adds nothing and removes a leftover noindex', () => {
  assert.equal(applyToHtml(HTML, true), HTML);
  assert.equal(applyToHtml(applyToHtml(HTML, false), true), HTML);
});

test('run(): staging writes robots.txt that blocks everyone; production does not', () => {
  const dist = mkdtempSync(join(tmpdir(), 'td-guard-'));
  try {
    writeFileSync(join(dist, 'index.html'), HTML);
    assert.equal(run(dist, undefined), 'staging');
    assert.equal(readFileSync(join(dist, 'robots.txt'), 'utf8'), ROBOTS_TXT);
    assert.match(ROBOTS_TXT, /User-agent: \*\r?\nDisallow: \/\r?\n/);
    assert.equal(run(dist, 'production'), 'production');
    assert.equal(existsSync(join(dist, 'robots.txt')), false);
    assert.equal(readFileSync(join(dist, 'index.html'), 'utf8'), HTML);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('vercel.json: noindex header is limited to staging hosts, never a catch-all', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rules = cfg.headers.filter((r) => r.headers.some((h) => h.key === 'X-Robots-Tag'));
  assert.ok(rules.length > 0, 'staging sends X-Robots-Tag');
  for (const r of rules) {
    assert.ok(r.headers.some((h) => h.key === 'X-Robots-Tag' && /noindex/.test(h.value)));
    assert.ok(Array.isArray(r.has) && r.has.some((c) => c.type === 'host'), 'X-Robots-Tag rule must be host-scoped');
  }
});
