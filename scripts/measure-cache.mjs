#!/usr/bin/env node
/**
 * Measures the five same-for-everyone reads (plan 3.5b) on STAGING: how long each answer takes, and how many of
 * the answers came out byte-identical. Run it once with every `public_cache` switch OFF and again with a switch
 * on; the two tables are the before/after in docs/API_CALLS.md section 8.
 *
 *   node scripts/measure-cache.mjs                 30 calls per read, one person, one after another
 *   node scripts/measure-cache.mjs --calls 60      more calls
 *   node scripts/measure-cache.mjs --label snapshots-on    a name printed with the table
 *
 * Needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values); staging only (the sign-in
 * helper refuses any other project). Signs in one seed person (Meera). Read-only: it only asks.
 */
import { memoProbes } from './lib/two-person.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const CALLS = Math.max(5, Number(arg('--calls', 30)) || 30);
const LABEL = arg('--label', 'run');

const { api, signIn } = await import('./lib/staging-session.mjs');
const person = await signIn('9990000003');

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const rows = [];
for (const { op, args } of memoProbes()) {
  const times = [];
  const bodies = new Set();
  let failed = 0;
  for (let i = 0; i < CALLS; i++) {
    const t0 = performance.now();
    const r = await api(person.token, op, args);
    times.push(performance.now() - t0);
    if (r.json?.ok) bodies.add(JSON.stringify(r.json.data));
    else failed++;
  }
  times.sort((x, y) => x - y);
  rows.push({
    read: `${op} ${JSON.stringify(args)}`,
    calls: CALLS,
    failed,
    'distinct answers': bodies.size,
    'median ms': Math.round(pct(times, 50)),
    'p95 ms': Math.round(pct(times, 95)),
  });
}
console.log(`\nmeasure-cache: ${LABEL}, ${CALLS} calls per read\n`);
console.table(rows);
