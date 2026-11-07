#!/usr/bin/env node
/**
 * The money check for the caches (plan 3.5b): money is never shown old.
 *
 * On STAGING (fake money, seed accounts) with the `public_cache` switches ON: the worker (Asha) reads her wallet
 * twice (so any reuse would have something to serve), the poster (Ravi) approves a finished job, and the worker's
 * very next read of her wallet, with no waiting, must show the new money. The poster's wallet must show exactly what
 * was held. The same is checked for the poster's task list: the task must show as COMPLETED on the first look.
 *
 * It posts one "[e2e]" task for ₹100 and moves about ₹103 of fake money (the same path as e2e/money.spec.ts).
 * `npm run seed:reset` (only with the owner's OK) puts the seed accounts back.
 *
 *   node scripts/money-freshness-check.mjs
 *
 * Needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values); staging only.
 */
import { targetRefusal } from './lib/two-person.mjs';

const refusal = targetRefusal(process.env.EXPO_PUBLIC_SUPABASE_URL);
if (refusal) {
  console.error(`Refusing to run: ${refusal}.`);
  process.exit(1);
}
const { api, signIn } = await import('./lib/staging-session.mjs');

const PRICE = 10_000; // ₹100, in paise
const failures = [];
const bad = (m) => {
  failures.push(m);
  console.error(`FAIL  ${m}`);
};
const ok = (m) => console.log(`ok    ${m}`);
const need = (r, what) => {
  if (!r.json?.ok) throw new Error(`${what} failed: ${r.status} ${String(r.json?.error?.message ?? r.text).slice(0, 140)}`);
  return r.json.data;
};
const total = (w) => w.balance_minor + w.clearing_minor;

// Ravi has the money on staging (Asha's wallet is nearly empty), so Ravi posts and Asha does the work.
const POSTER = { phone: '9990000002', name: 'Ravi' };
const WORKER = { phone: '9990000001', name: 'Asha' };
const worker = await signIn(WORKER.phone);
const poster = await signIn(POSTER.phone);
const wallet = async (p) => need(await api(p.token, 'getWallet'), 'getWallet');

const fees = need(await api(poster.token, 'platformFees'), 'platformFees');
const held = Math.round(PRICE * (1 + fees.posterFee));
const net = Math.round(PRICE * (1 - fees.commission));

// RESUME=1 finishes a run that stopped part way: it takes the poster's started "[e2e] money freshness check" task
// (its price is already held) instead of making a new one.
const RESUME = process.env.RESUME === '1';
let resumed = null;
if (RESUME) {
  const list = need(await api(poster.token, 'listMyTasks'), 'listMyTasks');
  const rows0 = Array.isArray(list) ? list : (list.tasks ?? list.items ?? []);
  resumed = rows0.find((t) => String(t.title).includes('money freshness check') && t.status === 'TASK_STARTED');
  if (!resumed) {
    console.error('RESUME=1 but no started "[e2e] money freshness check" task was found.');
    process.exit(2);
  }
}
const posterStart = { ...(await wallet(poster)) };
if (RESUME) posterStart.balance_minor += held; // the held amount already left the wallet
const workerStart = await wallet(worker);
if (total(posterStart) < held) {
  console.error(`the poster's staging wallet (${total(posterStart)}) is below what a job holds (${held}); not topping it up. Stopping.`);
  process.exit(2);
}

const task = resumed ?? need(
  await api(poster.token, 'createTask', {
    pillar: 'services',
    title: '[e2e] money freshness check',
    description: 'Cache money check on staging. Safe to ignore; it is removed when the test data is reset.',
    benchmarkMinor: PRICE,
    timeLimitMinutes: 60,
    kind: 'request',
    assignmentMode: 'bids',
  }),
  'createTask',
);
const bid = resumed ? null : need(await api(worker.token, 'placeBid', { taskId: task.id, priceMinor: PRICE, timeLimitMinutes: 60, message: 'I can do this today.' }), 'placeBid');
if (!resumed) {
  need(await api(poster.token, 'lockBid', { bidId: bid.id }), 'lockBid');
  need(await api(worker.token, 'startTask', { taskId: task.id }), 'startTask');
}
need(await api(worker.token, 'submitProof', { taskId: task.id, summary: 'Finished the work, all done.', files: [] }), 'submitProof');
need(await api(worker.token, 'markWorkDone', { taskId: task.id }), 'markWorkDone');

// Prime: read both wallets and the poster's task list twice, as a screen that reuses answers would.
await wallet(worker);
await wallet(worker);
await wallet(poster);
await api(poster.token, 'listMyTasks');
const workerBefore = await wallet(worker);
const posterLocked = await wallet(poster);

if (total(posterLocked) !== total(posterStart) - held) bad(`poster's wallet after locking: expected ${total(posterStart) - held}, saw ${total(posterLocked)}`);
else ok(`the poster's wallet dropped by exactly what was held (${held})`);

// The poster approves; the worker looks at once.
need(await api(poster.token, 'confirmRelease', { taskId: task.id }), 'confirmRelease');
const workerAfter = await wallet(worker);
need(await api(worker.token, 'settleClearedEarnings'), 'settleClearedEarnings');
const workerSettled = await wallet(worker);

if (total(workerAfter) !== total(workerBefore) + net) {
  bad(`worker's FIRST look after approval: expected total ${total(workerBefore) + net}, saw ${total(workerAfter)} (an old answer was served)`);
} else ok(`worker's first look after approval showed the new money (+${net}) with no waiting`);
if (total(workerSettled) !== total(workerBefore) + net) bad(`worker's wallet after settling: expected ${total(workerBefore) + net}, saw ${total(workerSettled)}`);
else ok('worker total unchanged after settling cleared earnings');

const posterEnd = await wallet(poster);
if (total(posterEnd) !== total(posterStart) - held) bad(`poster paid ${total(posterStart) - total(posterEnd)}, expected exactly ${held}`);
else ok('the poster paid exactly what was held, nothing more');

const mine = need(await api(poster.token, 'listMyTasks'), 'listMyTasks');
const rows = Array.isArray(mine) ? mine : (mine.tasks ?? mine.items ?? []);
const row = rows.find((t) => t.id === task.id);
if (row && row.status !== 'COMPLETED') bad(`poster's task list shows ${row.status}, expected COMPLETED on the first look`);
else if (row) ok('poster\'s task list shows COMPLETED on the first look');
else console.log('note  the task is not in the first page of the poster\'s list; skipped that check');

if (failures.length) {
  console.error(`\n${failures.length} problem(s).`);
  process.exit(1);
}
console.log('\nMoney was never shown old.');
