#!/usr/bin/env node
// `npm test`: finds the unit tests itself, so a PR that adds a test file does
// not have to edit one long line in package.json (that line made almost every
// PR merge-conflict). Drop a `*.test.ts`, `*.test.mjs` or `*.test.cjs` file
// under one of ROOTS and it runs.
//
// Two node runs, same flags as the old hand list:
//   1. node --experimental-strip-types --test <every found test>
//   2. node --experimental-transform-types --no-warnings --test <hook tests>
// A "hook test" compiles a component at run time through `register` from
// 'node:module' (FormPage, ListPage); it needs the transform flag, so it runs
// in the second group. The second run starts only if the first passes.
//
// `node scripts/run-unit-tests.mjs --list` prints the files instead of running.
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

// Folders the tests live in. e2e/ (Playwright, `npm run test:e2e`) is not here.
const ROOTS = ['apps', 'packages', 'scripts', 'supabase/functions'];

// Folders never searched.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'android', 'ios', 'coverage']);

const TEST_FILE = /\.test\.(ts|mjs|cjs)$/;

// Test files that exist but are NOT part of `npm test`. Each needs a reason.
const EXCLUDE = new Set([
  // Has its own script and CI job (`npm run test:contract`): it needs the old
  // app checked out in OLD_APP_DIR and different node flags.
  'supabase/functions/api/contract.test.ts',
  // Never added to the old hand-kept list in package.json, so `npm test` has
  // not been running them. They pass today (checked 26 Nov); kept off only so
  // this change runs exactly the same set as before. Delete these two lines to
  // switch them on.
  'apps/mobile/src/lib/chatWindow.test.ts',
  'apps/mobile/src/lib/offerTiming.test.ts',
]);

const HOOK_TEST = /import\s*\{[^}]*\bregister\b[^}]*\}\s*from\s*['"]node:module['"]/;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(join(repo, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(rel, out);
    } else if (e.isFile() && TEST_FILE.test(e.name)) {
      out.push(rel);
    }
  }
  return out;
}

const found = ROOTS.flatMap((r) => walk(r, []))
  .map((f) => f.split(sep).join('/'))
  .filter((f) => !EXCLUDE.has(f))
  .sort();

const hookTests = found.filter((f) => HOOK_TEST.test(readFileSync(join(repo, f), 'utf8')));
const plainTests = found.filter((f) => !hookTests.includes(f));

if (process.argv.includes('--list')) {
  for (const f of plainTests) console.log(f);
  for (const f of hookTests) console.log(f);
  process.exit(0);
}

function run(flags, files) {
  if (files.length === 0) return 0;
  const r = spawnSync(process.execPath, [...flags, '--test', ...files], {
    cwd: repo,
    stdio: 'inherit',
  });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

const first = run(['--experimental-strip-types'], plainTests);
if (first !== 0) process.exit(first);
process.exit(run(['--experimental-transform-types', '--no-warnings'], hookTests));
