#!/usr/bin/env node
// `npm run test:db`: runs every supabase/tests/*.test.sql in one psql session,
// stopping at the first error, so a PR that adds a SQL test does not have to
// edit one long line in package.json (that line made almost every PR
// merge-conflict). Drop a `*.test.sql` file in supabase/tests and it runs.
//
// Order: sorted by name. Order does not matter today: every file is its own
// `begin; ... rollback;` (guest_reads has two), nothing runs outside those
// transactions, and there is no setup file. A new test must keep that shape.
//
// Needs DATABASE_URL. `node scripts/run-db-tests.mjs --list` prints the files.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const dir = 'supabase/tests';

// SQL test files that exist but are NOT run. Each needs a reason. (None today.)
const EXCLUDE = new Set([]);

const files = readdirSync(`${repo}/${dir}`)
  .filter((f) => f.endsWith('.test.sql'))
  .map((f) => `${dir}/${f}`)
  .filter((f) => !EXCLUDE.has(f))
  .sort();

if (process.argv.includes('--list')) {
  for (const f of files) console.log(f);
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', ...files.flatMap((f) => ['-f', f])], {
  cwd: repo,
  stdio: 'inherit',
});
if (r.error) throw r.error;
process.exit(r.status ?? 1);
