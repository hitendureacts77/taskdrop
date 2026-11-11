import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { usesWorkerColours } from './roleColours.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');

test('signed-in worker is blue', () => {
  assert.equal(usesWorkerColours({ session: { id: 1 }, guest: false, mode: 'worker' }), true);
});
test('guest worker is blue', () => {
  assert.equal(usesWorkerColours({ session: null, guest: true, mode: 'worker' }), true);
});
test('signed-in poster is green', () => {
  assert.equal(usesWorkerColours({ session: { id: 1 }, guest: false, mode: 'poster' }), false);
});
test('guest poster is green', () => {
  assert.equal(usesWorkerColours({ session: null, guest: true, mode: 'poster' }), false);
});
test('no session and no guest stays green even in worker mode', () => {
  assert.equal(usesWorkerColours({ session: null, guest: false, mode: 'worker' }), false);
});

test('both roots use the one rule, not a session-only check', () => {
  for (const file of ['../../App.tsx', '../app/_layout.tsx']) {
    const src = read(file);
    assert.ok(src.includes('usesWorkerColours('), `${file} must call usesWorkerColours(`);
    assert.ok(!src.includes("Boolean(session) && mode === 'worker'"), `${file} gates blue on sign-in alone`);
  }
});

test('the blue palette still exists in ThemeProvider', () => {
  const src = read('../providers/ThemeProvider.tsx');
  const start = src.indexOf('const WORKER_ACCENT');
  assert.ok(start >= 0, 'WORKER_ACCENT missing');
  const block = src.slice(start, src.indexOf('} as const;', start));
  assert.ok(block.includes('#3A62E8'));
  assert.ok(block.includes('#2F5BEA'));
});
