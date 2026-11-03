// A rewritten database function must keep every refusal its previous version had.
//
// Migration 071 rewrote request_withdrawal from an older copy and silently lost
// three checks that 066 had added (plan task 2.14, hole H30). This compares the
// newest definition of each function with the one before it and lists every
// `raise exception '...'` message that disappeared. Drop a refusal on purpose by
// adding it to ACCEPTED below with the reason.
//
//   node scripts/check-lost-refusals.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

/** "schema.function: refusal" pairs dropped on purpose, each with why. */
export const ACCEPTED = new Map([
  // Example: ['public.some_function: The old refusal', 'replaced by the shared guard in 150'],
]);

const HEAD = /create\s+or\s+replace\s+function\s+([a-z_]+\.)?([a-z0-9_]+)\s*\(/gi;

/** The refusals in one function body. */
export function refusalsIn(body) {
  return new Set([...body.matchAll(/raise\s+exception\s+'((?:[^']|'')*)'/gi)].map((m) => m[1]));
}

/** Every definition of every function, in migration order: name -> [{ file, refusals }]. */
export function definitions(files) {
  const defs = new Map();
  for (const { name: file, sql } of files) {
    const starts = [...sql.matchAll(HEAD)];
    starts.forEach((m, i) => {
      const fn = (m[1] ?? 'public.').toLowerCase() + m[2].toLowerCase();
      const body = sql.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : sql.length);
      if (!defs.has(fn)) defs.set(fn, []);
      defs.get(fn).push({ file, refusals: refusalsIn(body) });
    });
  }
  return defs;
}

/** Refusals the newest definition of a function lost against the one before it, minus ACCEPTED. */
export function lostRefusals(files, accepted = ACCEPTED) {
  const lost = [];
  for (const [fn, list] of definitions(files)) {
    if (list.length < 2) continue;
    const [prev, latest] = list.slice(-2);
    for (const r of prev.refusals) {
      if (!latest.refusals.has(r) && !accepted.has(`${fn}: ${r}`)) lost.push({ fn, refusal: r, from: prev.file, to: latest.file });
    }
  }
  return lost;
}

export function readMigrations(dir = MIGRATIONS) {
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const lost = lostRefusals(readMigrations());
  for (const l of lost) console.error(`${l.fn} lost "${l.refusal}" (${l.from} -> ${l.to})`);
  if (lost.length) process.exit(1);
  console.log('Every rewritten function keeps the refusals of its previous version.');
}
