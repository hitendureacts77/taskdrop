#!/usr/bin/env node
/**
 * Supply-chain check on package-lock.json: every package we install comes from the public npm
 * registry over HTTPS and carries a checksum (`integrity`), so `npm ci` refuses a file that was
 * swapped on the way.
 *
 * It catches a dependency pulled from a git repository, a tarball URL or another registry -- the
 * usual way a look-alike or made-up package name ("slopsquatting") gets in. New packages still go
 * through review and the audit gate (scripts/audit-gate.mjs); this makes sure what was reviewed is
 * what gets installed. Workspace folders (apps/*, packages/*) are ours and are skipped.
 *
 *   node scripts/check-lockfile.mjs [path/to/package-lock.json]     exit 1 on any problem
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTRY = 'https://registry.npmjs.org/';

/**
 * @param {{ packages?: Record<string, { resolved?: string, integrity?: string, link?: boolean }> }} lock
 * @returns {{ name: string, why: string }[]}
 */
export function lockfileProblems(lock) {
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.includes('node_modules/') || entry.link) continue; // the root and our own workspaces
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!entry.resolved) {
      out.push({ name, why: 'has no download address' });
      continue;
    }
    if (!entry.resolved.startsWith(REGISTRY)) out.push({ name, why: `comes from ${entry.resolved.split('/').slice(0, 3).join('/')}, not the npm registry` });
    if (!entry.integrity) out.push({ name, why: 'has no checksum (integrity)' });
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../package-lock.json');
  const problems = lockfileProblems(JSON.parse(readFileSync(path, 'utf8')));
  for (const p of problems) console.log(`${p.name}  ${p.why}`);
  console.log(problems.length ? `\n${problems.length} package(s) need a look.` : 'Every package comes from the npm registry with a checksum.');
  process.exit(problems.length ? 1 : 0);
}
