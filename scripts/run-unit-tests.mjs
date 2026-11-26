#!/usr/bin/env node
// `npm test`: finds the unit tests itself, so a PR that adds a test file does
// not have to edit one long line in package.json (that line made almost every
// PR merge-conflict). Drop a `*.test.ts`, `*.test.mjs` or `*.test.cjs` file
// under one of ROOTS and it runs.
//
// Two node runs, same flags as the old hand list:
//   1. node --experimental-strip-types --test <tests that strip-only can load>
//   2. node --experimental-transform-types --no-warnings --test <the rest>
// A test goes to run 2 when it, or any local file it imports (followed
// through relative imports), is a .tsx file, uses TypeScript that strip-only
// mode refuses (parameter properties, enums, namespaces), or compiles code at
// run time through `register` from 'node:module' (FormPage, ListPage).
// The second run starts only if the first passes.
//
// `node scripts/run-unit-tests.mjs --list` prints both groups instead of running.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

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
const TYPE_ONLY_IMPORT = /\b(?:import|export)\s+type\s[^;]*?\bfrom\s*['"][^'"]+['"]/g;
const IMPORT_SPEC =/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(join(repo, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(rel, out);
    } else if (e.isFile() && TEST_FILE.test(e.name)) {
      out.push(rel);
    }
  }
  return out;
}

function resolveLocal(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const p of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

// Silence the "stripTypeScriptTypes is experimental" warning for this check only.
function stripsCleanly(code) {
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    stripTypeScriptTypes(code, { mode: 'strip' });
    return true;
  } catch {
    return false;
  } finally {
    process.emitWarning = emit;
  }
}

const verdict = new Map(); // absolute path -> true when it needs transform-types
function needsTransform(file, seen = new Set()) {
  if (verdict.has(file)) return verdict.get(file);
  if (seen.has(file)) return false; // import cycle: decided by the first visit
  seen.add(file);
  const code = readFileSync(file, 'utf8');
  let needs =
    file.endsWith('.tsx') ||
    HOOK_TEST.test(code) ||
    (/\.(ts|mts|cts)$/.test(file) && !stripsCleanly(code));
  if (!needs) {
    // `import type` / `export type` lines are erased, so node never loads those files.
    const loaded = code.replace(TYPE_ONLY_IMPORT, '');
    for (const m of loaded.matchAll(IMPORT_SPEC)) {
      const dep = resolveLocal(file, m[1]);
      if (dep && /\.(ts|tsx|mts|mjs|js|cjs)$/.test(dep) && needsTransform(dep, seen)) {
        needs = true;
        break;
      }
    }
  }
  verdict.set(file, needs);
  return needs;
}

const found = ROOTS.flatMap((r) => walk(r, []))
  .map((f) => f.split(sep).join('/'))
  .filter((f) => !EXCLUDE.has(f))
  .sort();

const transformTests = found.filter((f) => needsTransform(join(repo, f)));
const stripTests = found.filter((f) => !transformTests.includes(f));

if (process.argv.includes('--list')) {
  for (const f of stripTests) console.log(`strip     ${f}`);
  for (const f of transformTests) console.log(`transform ${f}`);
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

const first = run(['--experimental-strip-types'], stripTests);
if (first !== 0) process.exit(first);
process.exit(run(['--experimental-transform-types', '--no-warnings'], transformTests));
