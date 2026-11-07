#!/usr/bin/env node
/**
 * A small load test of the app's single door (`api`) on STAGING (plan task 3.6, T9).
 *
 *   Phase 1  Ordinary load: three seed people read at the same time (a Home-like mix of reads), a few at once
 *            each. Reports the median, 95th percentile and slowest answer, and any error.
 *   Phase 2  Over the budget: one seed person sends more reads in a minute than the limit (300). The server must
 *            answer the extra ones with 429 and a clean refusal, never a 5xx.
 *
 * Reads only: nothing is written. Fake accounts, fake data, staging project only (the helper refuses anything
 * else). Keep it small: the free plan is shared with the testers.
 *
 *   node scripts/load-test.mjs              # both phases
 *   node scripts/load-test.mjs --per 60     # reads per person in phase 1 (default 60)
 *   node scripts/load-test.mjs --public     # read the same-for-everyone lists instead (plan 3.5b caches);
 *                                           # run it with the `public_cache` switches on, then off, and compare
 *
 * Needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values). Exit 1 if a request failed
 * with a 5xx or a network error, or phase 2 never saw a 429.
 */
import { api, signIn } from './lib/staging-session.mjs';
import { memoProbes } from './lib/two-person.mjs';

const per = Number(process.argv[process.argv.indexOf('--per') + 1]) || 60;
const AT_ONCE = 4;
const READS = process.argv.includes('--public')
  ? memoProbes().map(({ op, args }) => [op, args])
  : [
      ['getProfile', {}],
      ['recommendedTasks', { limit: 10 }],
      ['recommendedTasks', { limit: 10, skills: ['writing'] }],
    ];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const summary = (label, samples) => {
  const bodies = [...new Set(samples.filter((s) => s.body !== undefined).map((s) => s.body))];
  for (const b of bodies.slice(0, 3)) console.log(`  a 5xx answer said: ${b}`);
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const by = {};
  for (const s of samples) by[s.status] = (by[s.status] ?? 0) + 1;
  console.log(`${label}: ${samples.length} reads | median ${Math.round(pct(ms, 50))} ms | p95 ${Math.round(pct(ms, 95))} ms | slowest ${Math.round(ms.at(-1) ?? 0)} ms | statuses ${JSON.stringify(by)}`);
};

async function timed(token, i) {
  const [op, args] = READS[i % READS.length];
  const t0 = performance.now();
  const r = await api(token, op, args);
  return { ms: performance.now() - t0, status: r.status, body: r.status >= 500 ? String(r.text ?? '').slice(0, 160) : undefined };
}

/** Runs `total` reads for one person, `AT_ONCE` at a time. */
async function run(token, total) {
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      while (next < total) out.push(await timed(token, next++));
    }),
  );
  return out;
}

const people = [];
for (const phone of ['9990000001', '9990000002', '9990000003']) people.push(await signIn(phone));

console.log('Phase 1: ordinary load');
const t0 = performance.now();
const phase1 = (await Promise.all(people.map((p) => run(p.token, per)))).flat();
console.log(`  took ${((performance.now() - t0) / 1000).toFixed(1)} s for ${phase1.length} reads from ${people.length} people`);
summary('  phase 1', phase1);

console.log('Phase 2: one person over the read budget (300 a minute)');
await new Promise((r) => setTimeout(r, 62_000)); // a fresh minute for the counter
const over = await (async () => {
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      while (next < 330) out.push(await timed(people[2].token, next++));
    }),
  );
  return out;
})();
summary('  phase 2', over);

const all = [...phase1, ...over];
const serverErrors = all.filter((s) => s.status === 0 || s.status >= 500);
const limited = over.filter((s) => s.status === 429).length;
const ok = serverErrors.length === 0 && limited > 0;
console.log(`${serverErrors.length} server or network errors; ${limited} reads refused with 429 once over the budget`);
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
