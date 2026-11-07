#!/usr/bin/env node
/**
 * Direct-door test (docs/ULTIMATE_PLAN.md task 2.18 part B; holes H3 and H52).
 *
 * The app only talks to the `api` function, but the database also answers on its own REST address,
 * /rest/v1/<table>, to anyone holding the public key. On STAGING this knocks on that door for every table, READS
 * ONLY, as nobody (signed out) and as seed person A, asking for seed person B's rows:
 *
 *   signed out   must read nothing, anywhere.
 *   person A     must get none of B's private rows. A may read what row rules allow on purpose (PUBLIC_BY_DESIGN
 *                in scripts/lib/direct-door.mjs). Reading ALLOWED rows directly is the known open door H52
 *                and is expected until task 3.9.
 *   --gateway-only   for after task 3.9: every request must be refused, for both callers.
 *
 * It sends only GET requests with `limit=0` and reads only the row COUNT header, so no row value ever reaches this
 * script, and it prints counts and verdicts only. It never writes and calls no database function. A failure prints
 * the exact request, with no key and no token.
 *
 * The table list comes from the migrations (no signed-out schema listing exists): either built on the fly, or from a
 * file written by `--write-tables FILE` and passed back with `--tables FILE`.
 *
 *   node --env-file=apps/mobile/.env scripts/direct-door-test.mjs
 *   node scripts/direct-door-test.mjs --write-tables tables.txt   (writes the list, calls nothing)
 *   node scripts/direct-door-test.mjs --dry-run                   (prints the plan and the target check, calls nothing)
 *
 * Needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values); refuses any project but
 * staging. Not part of `npm test`. Exit 1 if anything failed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  describeRequest, judge, noSuchColumn, OWNER_COLUMNS, parseTableList, readRequest, summarise, tablesFromMigrations,
  targetRefusal,
} from './lib/direct-door.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valueOf = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const DRY_RUN = flag('--dry-run');
const GATEWAY_ONLY = flag('--gateway-only');

const tables = valueOf('--tables') ? parseTableList(readFileSync(valueOf('--tables'), 'utf8')) : tablesFromMigrations();

if (valueOf('--write-tables')) {
  writeFileSync(valueOf('--write-tables'), `# public tables, read from supabase/migrations\n${tables.join('\n')}\n`);
  console.log(`Wrote ${tables.length} table names to ${valueOf('--write-tables')}.`);
  process.exit(0);
}

const refusal = targetRefusal(process.env.EXPO_PUBLIC_SUPABASE_URL);

if (DRY_RUN) {
  console.log(`Direct-door test plan: ${tables.length} tables, each read (GET, count only) as signed out and as person A, asking for person B's rows.`);
  console.log(GATEWAY_ONLY ? 'Mode: --gateway-only (every request must be refused).' : 'Mode: H52 expected (row rules decide; public-by-design tables are allowed).');
  console.log(refusal ? `Target: would refuse to run (${refusal}).` : 'Target: staging project, accepted.');
  console.log('Dry run: nothing was called.');
  process.exit(0);
}

if (refusal) {
  console.error(`Refusing to run: ${refusal}.`);
  process.exit(1);
}

// Imported only now: it needs the staging values and signs a seed person in.
const { URL: BASE, KEY, signIn } = await import('./lib/staging-session.mjs');

const A = { phone: '9990000003' }; // Meera, a stranger to B
const B = { phone: '9990000001' }; // Asha, who has tasks and a wallet

/** One read. The only network call this script makes against the tables. Never throws. */
async function read(req, token) {
  if (req.method !== 'GET') throw new Error('this test only reads');
  const headers = { apikey: KEY, Prefer: 'count=exact', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(req.url, { method: 'GET', headers });
    const text = res.status >= 400 ? await res.text() : '';
    return summarise(res.status, text, res.headers.get('content-range'));
  } catch {
    return { status: 0, code: 'network', count: null };
  }
}

/** Ask about person B through the first owner column the table has; a table with none is asked for everything visible. */
async function knock(table, personId, token) {
  for (const column of table === 'profiles' ? ['id'] : OWNER_COLUMNS) {
    const req = readRequest(BASE, table, column, personId);
    const summary = await read(req, token);
    if (noSuchColumn(summary)) continue;
    return { req, summary, kind: 'owner' };
  }
  const req = readRequest(BASE, table, null, null);
  return { req, summary: await read(req, token), kind: 'global' };
}

console.log('Signing in the two seed people on staging (no account is created)...');
const personA = await signIn(A.phone);
const personB = await signIn(B.phone);
console.log(`Mode: ${GATEWAY_ONLY ? 'gateway-only (every request must be refused)' : 'H52 expected (row rules decide)'}. Tables: ${tables.length}.\n`);

const failures = [];
const tally = { ok: 0, 'by-design': 0, fail: 0 };
const lines = [];

for (const [who, token] of [['signed-out', null], ['person-a', personA.token]]) {
  for (const table of tables) {
    const { req, summary, kind } = await knock(table, personB.userId, token);
    const v = judge({ who, table, kind, summary, gatewayOnly: GATEWAY_ONLY });
    tally[v.verdict]++;
    lines.push(`${v.verdict.padEnd(9)} ${who.padEnd(10)} ${table.padEnd(26)} status ${String(summary.status).padEnd(3)} count ${String(summary.count ?? '-').padEnd(4)} ${v.why}`);
    if (v.verdict === 'fail') failures.push(`${table}: ${v.why}\n    ${describeRequest(req, who)}`);
  }
}

// A control, so a blind test cannot pass: person A reading A's own profile row must work (unless gateway-only).
if (!GATEWAY_ONLY) {
  const req = readRequest(BASE, 'profiles', 'id', personA.userId);
  const s = await read(req, personA.token);
  const ok = s.status < 400 && (s.count ?? 0) >= 1;
  lines.push(`${ok ? 'ok' : 'fail'}        control    profiles (own row)         status ${s.status} count ${s.count ?? '-'}`);
  if (!ok) {
    tally.fail++;
    failures.push(`control: person A could not read their own profile, so the other results mean nothing\n    ${describeRequest(req, 'person-a')}`);
  }
}

console.log(lines.join('\n'));
console.log(`\n${tally.ok} ok, ${tally['by-design']} allowed by design or not attributable, ${tally.fail} failed.`);
if (failures.length) {
  console.log('\nFAILURES');
  for (const f of failures) console.log(`- ${f}`);
  process.exit(1);
}
console.log(GATEWAY_ONLY ? 'The direct door is shut for both callers.' : 'Signed out read nothing; person A reached none of B\'s private rows.');
