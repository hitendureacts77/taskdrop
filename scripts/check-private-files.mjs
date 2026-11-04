#!/usr/bin/env node
/**
 * Every user file stays private (docs/ULTIMATE_PLAN.md task 2.13 part H, hole H27 and your rule "every document private").
 *
 * Checks the code for the ways a file could become public by accident. `npm test` runs it, so a change that
 * weakens any of these fails before it ships:
 *
 *   - the app uploads to ImageKit as a private file, and the server refuses an upload that is not private
 *   - no code asks for a public link to a stored file (getPublicUrl)
 *   - no migration makes a storage bucket public
 *   - a link to a file stops working within two hours (ImageKit: between one and two) or one hour (Storage)
 *
 * The matching live test (a private file opened without a fresh signed link is refused) is scripts/security-storage.mjs.
 *
 *   node scripts/check-private-files.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const slash = (p) => relative(ROOT, p).split(sep).join('/');

function walk(dir, keep) {
  const out = [];
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist' || f === '.expo') continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** Problems found, as plain sentences. `files` lets a test hand in fake sources. */
export function problems(files = {}) {
  const out = [];
  const get = (p) => files[p] ?? read(p);

  if (!/form\.append\(\s*['"]isPrivateFile['"]\s*,\s*['"]true['"]\s*\)/.test(get('apps/mobile/src/lib/media.ts'))) {
    out.push('apps/mobile/src/lib/media.ts: the upload no longer says isPrivateFile = true');
  }
  if (!/isPrivateFile\s*!==\s*true/.test(get('supabase/functions/api/media.ts'))) {
    out.push('supabase/functions/api/media.ts: the server no longer refuses an upload that is not a private file');
  }
  const product = (get('supabase/functions/api/media.ts').match(/SIGNED_URL_SECONDS\s*=\s*([\d\s*]+);/) ?? [])[1];
  const seconds = product ? product.split('*').reduce((a, b) => a * Number(b.trim()), 1) : 0;
  if (!(seconds > 0 && seconds <= 3600)) out.push(`supabase/functions/api/media.ts: Storage links last ${seconds || 'an unknown number of'} seconds; they must stop within an hour`);

  const code = files.code ?? [
    ...walk(join(ROOT, 'apps/mobile/src'), (p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p)),
    ...walk(join(ROOT, 'supabase/functions'), (p) => /\.ts$/.test(p) && !/\.test\./.test(p)),
  ].map((p) => [slash(p), readFileSync(p, 'utf8')]);
  for (const [path, text] of code) {
    if (/getPublicUrl\s*\(/.test(text)) out.push(`${path}: asks for a public link to a stored file (getPublicUrl)`);
  }

  const migrations = files.migrations ?? walk(join(ROOT, 'supabase/migrations'), (p) => p.endsWith('.sql')).map((p) => [slash(p), readFileSync(p, 'utf8')]);
  for (const [path, sql] of migrations) {
    for (const m of sql.matchAll(/(?:insert\s+into|update)\s+storage\.buckets[^;]*;/gi)) {
      const stmt = m[0].replace(/--.*$/gm, '');
      if (/\bpublic\s*=\s*true\b/i.test(stmt) || /\bvalues\s*\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*true\b/i.test(stmt)) out.push(`${path}: makes a storage bucket public`);
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = problems();
  for (const p of found) console.log(p);
  console.log(found.length ? `\n${found.length} problem(s).` : 'No user file can become public by accident.');
  process.exit(found.length ? 1 : 0);
}
