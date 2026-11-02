// node --test scripts/check-lockfile.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { lockfileProblems } from './check-lockfile.mjs';

const ok = { resolved: 'https://registry.npmjs.org/zod/-/zod-4.1.0.tgz', integrity: 'sha512-abc' };

test('this repo installs only registry packages with checksums', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.deepEqual(lockfileProblems(lock), []);
});

test('our own workspaces and the root are skipped', () => {
  assert.deepEqual(lockfileProblems({ packages: { '': {}, 'apps/mobile': {}, 'node_modules/@taskdrop/rules': { link: true }, 'node_modules/zod': ok } }), []);
});

test('a git, tarball or other-registry source is refused', () => {
  const p = lockfileProblems({
    packages: {
      'node_modules/a': { resolved: 'git+ssh://git@github.com/x/a.git#abc', integrity: 'sha512-x' },
      'node_modules/b': { resolved: 'https://evil.example/b.tgz', integrity: 'sha512-x' },
      'node_modules/c/node_modules/d': { resolved: 'http://registry.npmjs.org/d/-/d-1.0.0.tgz', integrity: 'sha512-x' },
    },
  });
  assert.deepEqual(p.map((x) => x.name), ['a', 'b', 'd']);
});

test('a package without a checksum or address is refused', () => {
  const p = lockfileProblems({ packages: { 'node_modules/a': { resolved: ok.resolved }, 'node_modules/b': {} } });
  assert.deepEqual(p.map((x) => x.why), ['has no checksum (integrity)', 'has no download address']);
});
