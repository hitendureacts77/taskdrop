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
 * The cache section (plan 3.5b task 8) runs first: the same-for-everyone reads (PUBLIC_MEMO_OPS) must give
 * A, B and a guest byte-identical answers with nothing private in them, the never-reused money reads must
 * re-ask every time and show a change at once, and B must never be handed A's answers right after A asked.
 * cachePlan() in scripts/lib/two-person.mjs lists every step; --dry-run prints it.
 *
 * Needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values); refuses any project but
 * staging, and production (taskdrop.in, admin.taskdrop.in) by name. Runs on its own in
 * .github/workflows/two-person.yml. Exit 1 if anything leaked or changed.
 *
 *   node scripts/two-person-test.mjs               everything
 *   node scripts/two-person-test.mjs --cache-only  only the cache section
 *   node scripts/two-person-test.mjs --dry-run     print the plan and the target check, call nothing, exit 0
 */
import {
  cachePlan, differences, leaked, memoProbes, phoneMarker, privateHits, probedOps, readOpNames, stateOf, strings,
  targetRefusal, uuidsByKey,
} from './lib/two-person.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const CACHE_ONLY = process.argv.includes('--cache-only');

if (DRY_RUN) {
  const refusal = targetRefusal(process.env.EXPO_PUBLIC_SUPABASE_URL);
  console.log(cachePlan().join('\n'));
  console.log(CACHE_ONLY ? '\nThen stop (--cache-only).' : `\nThen the full two-person probe: A calls ${probedOps().length} operations with B's ids.`);
  console.log(refusal ? `\nTarget: would refuse to run (${refusal}).` : '\nTarget: staging project, accepted.');
  console.log('Dry run: nothing was called.');
  process.exit(0);
}

{
  const refusal = targetRefusal(process.env.EXPO_PUBLIC_SUPABASE_URL);
  if (refusal) {
    console.error(`Refusing to run: ${refusal}.`);
    process.exit(1);
  }
}
// Imported only now: it signs people in, and throws without the staging values.
const { URL: BASE, KEY, api, headers: baseHeaders, signIn } = await import('./lib/staging-session.mjs');

const A = { phone: '9990000003', label: 'Meera (stranger)' };
const B = { phone: '9990000001', label: 'Asha (poster)' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);
const UPI = `twop${rand}@okaxis`;
const BUILDING = `Twop${rand} Residency`;

const findings = [];
const bad = (what) => {
  if (!findings.includes(what)) findings.push(what);
};

const rows = (r) => {
  const d = r.json?.ok ? r.json.data : null;
  return Array.isArray(d) ? d : d && Array.isArray(d.rows) ? d.rows : [];
};
const data = (r) => (r.json?.ok ? r.json.data : null);

/** One api call that also returns the response's Cache-Control header. Never throws. */
async function apiWithHeaders(token, op, args = {}) {
  try {
    const res = await fetch(`${BASE}/functions/v1/api`, {
      method: 'POST',
      headers: { ...baseHeaders, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ op, args }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text, cacheControl: res.headers.get('cache-control') ?? '' };
  } catch (e) {
    return { status: 0, json: null, text: String(e), cacheControl: '' };
  }
}

/** The private things of a signed-in person that no shared answer may carry. */
async function markersOf(person, phone) {
  const { data } = await person.client.auth.getUser(person.token).catch(() => ({ data: null }));
  return { ids: [person.userId], other: [phoneMarker(phone), data?.user?.email || null].filter(Boolean) };
}

/** The cache section (plan 3.5b task 8). Adds its findings to `findings`. */
async function cacheSection(a, b) {
  const guest = KEY; // the public key with nobody behind it is a guest (design D15)
  const [ma, mb] = [await markersOf(a, A.phone), await markersOf(b, B.phone)];
  const markers = { ids: [...ma.ids, ...mb.ids], other: [...ma.other, ...mb.other] };

  // ---- 1. shared reads: same bytes for A, B and a guest, nothing private
  for (const { op, args, guest: guestMay } of memoProbes()) {
    const name = `${op} ${JSON.stringify(args)}`;
    let answers = null;
    let diff = 'not asked';
    for (let attempt = 0; attempt < 3 && diff; attempt++) {
      if (attempt) await wait(2000);
      const [ra, rb, rg] = await Promise.all([api(a.token, op, args), api(b.token, op, args), api(guest, op, args)]);
      if (!ra.json?.ok || !rb.json?.ok) {
        diff = `could not be read (A ${ra.status}, B ${rb.status}: ${(ra.json?.error?.message ?? rb.json?.error?.message ?? '').slice(0, 80)})`;
        continue;
      }
      if (!guestMay && rg.json?.error?.code !== 'NEEDS_ACCOUNT') bad(`cache: ${name}: a guest was not told to make an account (${rg.status})`);
      answers = guestMay ? { A: ra.json.data, B: rb.json.data, guest: rg.json?.ok ? rg.json.data : { refused: rg.status } } : { A: ra.json.data, B: rb.json.data };
      diff = differences(answers);
    }
    if (diff) bad(`cache: ${name}: answers were not byte-identical: ${diff}`);
    for (const [who, v] of Object.entries(answers ?? {})) {
      const hits = privateHits(op, v, markers);
      if (hits.length) bad(`cache: ${name}: ${who}'s answer carries something private: ${hits.slice(0, 5).join(' | ')}`);
    }
    await wait(250);
  }

  // ---- 2. never-reused money reads: re-asked every time, a change shows at once
  for (const op of ['getWallet', 'listPayoutDestinations']) {
    const r = await apiWithHeaders(b.token, op);
    if (!/no-store/i.test(r.cacheControl)) bad(`cache: ${op} answered without "Cache-Control: no-store" (${r.cacheControl || 'none'})`);
  }
  const upi = `twopc${rand}@okaxis`;
  const before = await api(b.token, 'listPayoutDestinations');
  const added = await api(b.token, 'addPayoutDestination', { kind: 'upi', label: 'twopc', upiId: upi });
  const addedId = data(added)?.id;
  try {
    if (!addedId) bad(`cache: could not add a payout destination to see a change (${added.status} ${added.text.slice(0, 100)})`);
    else {
      const after = await api(b.token, 'listPayoutDestinations');
      if (leaked(before.text, [upi]).length) bad('cache: the payout list showed the destination before it was added');
      if (!leaked(after.text, [upi]).length) bad('cache: the payout list asked a moment after a destination was added did not show it (an old answer was served)');
    }
  } finally {
    if (addedId) await api(b.token, 'removePayoutDestination', { id: addedId }).catch(() => {});
  }
  if (addedId) {
    const gone = await api(b.token, 'listPayoutDestinations');
    if (leaked(gone.text, [upi]).length) bad('cache: the payout list still showed a destination a moment after it was removed (an old answer was served)');
  }

  // ---- 3. account switch: what A was just told never reaches B
  for (const op of ['getWallet', 'listMyTasks', 'listNotifications']) {
    await api(a.token, op);
    const rb = await api(b.token, op);
    if (leaked(rb.text, [a.userId]).length) bad(`cache: ${op}: B, asking right after A, was handed something with A's id`);
    if (op === 'getWallet' && !leaked(rb.text, [b.userId]).length) bad('control: B\'s own wallet does not show B\'s id, so the switch check could not see a wrong person\'s answer');
    await wait(250);
  }
}

async function main() {
  const [a, b] = [await signIn(A.phone), await signIn(B.phone)];
  const asB = (op, args) => api(b.token, op, args);

  await cacheSection(a, b);
  if (CACHE_ONLY) return;

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
        let r = await api(a.token, op, args);
        // A gateway blip (a function restarting during a deploy) is not a finding: ask once more before counting it.
        if (r.status >= 500 || r.status === 0) {
          await wait(3000);
          r = await api(a.token, op, args);
        }
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
