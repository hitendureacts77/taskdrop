#!/usr/bin/env node
/**
 * Two-person test (docs/ULTIMATE_PLAN.md task 2.13 part G): person A must never reach person B's data.
 *
 * On STAGING (fake accounts) it signs in two seed people. B (Asha, who has tasks and a wallet) gets private
 * things with recognisable marks: a payout destination (a UPI id), a task whose exact address has a building
 * name in it, and her own phone number and chat messages. Then A (Meera, a stranger to B) calls EVERY operation
 * of the api (the list is read from the source, so a new operation is probed automatically) with B's ids
 * in every place an id can go, and the test checks two things:
 *
 *   1. nothing A is told contains one of B's private marks (the exact address, the UPI id, B's phone number,
 *      B's chat messages), and
 *   2. B's own state (her tasks, her payout destinations, her wallet, her notice count) is exactly the same
 *      after A has tried everything.
 *
 * Positive controls prove the marks are findable: B's own reads must contain them, or the run fails (a test
 * that cannot see the leak would pass for the wrong reason).
 *
 * Needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values); refuses any project but
 * staging. Runs on its own in .github/workflows/two-person.yml. Exit 1 if anything leaked or changed.
 *
 *   node scripts/two-person-test.mjs
 */
import { api, signIn } from './lib/staging-session.mjs';
import { leaked, phoneMarker, probedOps, readOpNames, stateOf, strings, uuidsByKey } from './lib/two-person.mjs';

const A = { phone: '9990000003', label: 'Meera (stranger)' };
const B = { phone: '9990000001', label: 'Asha (poster)' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);
const UPI = `twop${rand}@okaxis`;
const BUILDING = `Twop${rand} Residency`;

const findings = [];
const bad = (what) => findings.push(what);

const rows = (r) => {
  const d = r.json?.ok ? r.json.data : null;
  return Array.isArray(d) ? d : d && Array.isArray(d.rows) ? d.rows : [];
};
const data = (r) => (r.json?.ok ? r.json.data : null);

async function main() {
  const [a, b] = [await signIn(A.phone), await signIn(B.phone)];
  const asB = (op, args) => api(b.token, op, args);

  // ---- B's private things
  const dest = await asB('addPayoutDestination', { kind: 'upi', label: 'twop', upiId: UPI });
  const task = await asB('createTask', {
    pillar: 'services', title: `[2p-test] ${rand}`, description: 'two-person test. Safe to ignore.', benchmarkMinor: 5_000, timeLimitMinutes: 60,
    locLabel: `Flat 402, ${BUILDING}, Madhapur, Hyderabad`,
  });
  const destId = data(dest)?.id;
  const taskId = data(task)?.id;
  if (!destId || !taskId) throw new Error(`could not set up B: destination ${dest.status} ${dest.text.slice(0, 120)}, task ${task.status} ${task.text.slice(0, 120)}`);

  try {
    // ---- B's own reads: ids to aim at, chat text to protect, and the positive controls
    const reads = {
      tasks: await asB('listMyTasks'),
      bids: await asB('listMyBids'),
      assignments: await asB('listMyAssignments'),
      payouts: await asB('listPayouts'),
      destinations: await asB('listPayoutDestinations'),
      wallet: await asB('getWallet'),
      activity: await asB('listWalletActivity'),
      notifications: await asB('listNotifications'),
      threads: await asB('listThreads'),
      tickets: await asB('listTickets'),
      disputes: await asB('listMyDisputes'),
    };
    const detail = await asB('getTaskDetail', { taskId });
    if (!leaked(reads.destinations.text, [UPI]).length) bad('control: B\'s own payout destinations do not show the UPI mark, so the test could not see a leak of it');
    if (!leaked(detail.text + reads.tasks.text, [BUILDING]).length) bad('control: B\'s own view of her task does not show the exact address mark, so the test could not see a leak of it');

    const messages = [];
    for (const t of rows(reads.threads).slice(0, 5)) {
      const id = t.task_id ?? t.taskId ?? t.id;
      const m = await asB('listMessages', { taskId: id });
      for (const s of strings(data(m))) if (s.length >= 14 && !/^[0-9a-f-]{36}$/i.test(s) && !/^\d{4}-\d{2}-\d{2}/.test(s)) messages.push(s);
    }
    const markers = [UPI, BUILDING, phoneMarker(B.phone), ...new Set(messages)].slice(0, 40);

    // ---- the ids A will aim at
    const ids = (r, key) => [...(uuidsByKey(data(r))[key] ?? [])];
    const aim = {
      taskId, userId: b.userId, destinationId: destId,
      bidId: ids(reads.bids, 'id')[0], payoutId: ids(reads.payouts, 'id')[0], ticketId: ids(reads.tickets, 'id')[0],
      disputeId: ids(reads.disputes, 'id')[0], notificationId: ids(reads.notifications, 'id')[0],
      assignmentId: ids(reads.assignments, 'id')[0], workerId: b.userId, posterId: b.userId, otherUserId: b.userId,
    };
    for (const k of Object.keys(aim)) if (!aim[k]) delete aim[k];
    const idVariants = [taskId, destId, aim.bidId, aim.payoutId, aim.ticketId, aim.notificationId].filter(Boolean);

    const before = stateOf({ tasks: data(reads.tasks), destinations: data(reads.destinations), wallet: data(reads.wallet), notifications: data(reads.notifications) });

    // ---- A tries everything
    const isRead = readOpNames();
    let calls = 0;
    for (const op of probedOps()) {
      const reading = isRead.has(op);
      const variants = reading ? [aim, ...idVariants.map((id) => ({ ...aim, id }))] : [aim, { ...aim, id: destId }, { ...aim, id: taskId }];
      for (const args of variants) {
        const r = await api(a.token, op, args);
        calls++;
        if (r.status === 429) {
          await wait(15_000);
          continue;
        }
        if (r.status >= 500 || r.status === 0) bad(`${op}: server error ${r.status}`);
        const hit = leaked(r.text, markers);
        if (hit.length) bad(`${op}: A was told something private of B's: ${hit.map((h) => (h.length > 40 ? h.slice(0, 40) + '…' : h)).join(' | ')}`);
        await wait(reading ? 250 : 1100);
      }
    }

    // ---- B's state is untouched
    const after = stateOf({
      tasks: data(await asB('listMyTasks')), destinations: data(await asB('listPayoutDestinations')),
      wallet: data(await asB('getWallet')), notifications: data(await asB('listNotifications')),
    });
    if (after !== before) bad('B\'s own state (tasks, payout destinations, wallet or notices) changed while A was trying things');
    console.log(`A sent ${calls} calls over ${probedOps().length} operations; ${markers.length} private marks guarded.`);
  } finally {
    await asB('cancelTask', { taskId }).catch(() => {});
    await asB('removePayoutDestination', { id: destId }).catch(() => {});
  }
}

main()
  .then(() => {
    for (const f of findings) console.log('FAIL  ' + f);
    console.log(findings.length ? `\n${findings.length} problem(s).` : 'Person A reached nothing of person B\'s.');
    process.exit(findings.length ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
