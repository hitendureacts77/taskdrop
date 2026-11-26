import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closedLine,
  customerShown,
  dueIn,
  elapsed,
  firstName,
  posterDateBits,
  posterHint,
  posterNeeds,
  posterNextStep,
  posterPill,
  posterStage,
  posterTabOf,
  statusBadge,
  whereLine,
  workerButton,
  workerNeeds,
  workerNextStep,
  workerPill,
  workerStage,
} from './myTasksBoard.ts';

const NOW = new Date(2026, 10, 18, 10, 0).getTime();
const money = (m: number) => `₹${(m / 100).toFixed(m % 100 ? 2 : 0)}`;
const task = (status: string, extra: Record<string, unknown> = {}) => ({ id: status, status, title: 'Fix a fan', ...extra });

test('poster needs: review first, then pay, then offers, then a passed date with no offers', () => {
  const tasks = [
    task('OPEN', { id: 'o1', due_at: new Date(NOW + 86_400_000).toISOString() }),
    task('OPEN', { id: 'o2', due_at: new Date(NOW - 86_400_000).toISOString() }),
    task('LOCKED', { id: 'l1' }),
    task('LOCKED', { id: 'l2', funded_at: '2026-11-17' }),
    task('WORK_DONE', { id: 'w1', auto_complete_at: new Date(2026, 10, 25, 17, 25).toISOString() }),
    task('TASK_STARTED', { id: 's1' }),
  ];
  const needs = posterNeeds(tasks, {
    offersOf: (id) => (id === 'o1' ? 3 : 0),
    nameOf: (id) => (id === 'w1' ? 'Ravi Kumar' : null),
    payText: () => '₹463.50',
    now: NOW,
  });
  assert.deepEqual(needs.map((n) => n.kind), ['review', 'pay', 'choose', 'repost']);
  assert.equal(needs[0]!.lead, 'Review Ravi’s work');
  assert.equal(needs[0]!.hint, 'Auto-releases Wed 25 Nov, 5:25 pm');
  assert.equal(needs[1]!.lead, 'Pay ₹463.50 so the worker can start');
  assert.equal(needs[2]!.lead, '3 offers to choose from');
  assert.equal(needs[3]!.action, 'Post again');
});

test('a funded locked task, a started one and a quiet open post need nothing', () => {
  const needs = posterNeeds([task('LOCKED', { funded_at: 'x' }), task('TASK_STARTED'), task('OPEN')], {
    offersOf: () => 0,
    nameOf: () => null,
    payText: () => '',
    now: NOW,
  });
  assert.equal(needs.length, 0);
});

test('next step box words follow the live states', () => {
  const x = { name: 'Suresh Reddy', payText: '₹463.50', now: NOW };
  assert.match(posterNextStep(task('LOCKED'), x)!.text, /^Pay ₹463\.50 so Suresh can start\. Contacts are shared once work starts\.$/);
  assert.equal(posterNextStep(task('LOCKED', { funded_at: 'x' }), x)!.text, 'Paid. Suresh starts next.');
  assert.equal(posterNextStep(task('TASK_STARTED', { due_at: new Date(2026, 10, 18, 13, 0).toISOString() }), x)!.text, 'Suresh is working · due today 1 pm');
  assert.equal(posterNextStep(task('REVISION_REQUESTED'), x)!.text, 'You asked for changes. Suresh is fixing it.');
  assert.equal(posterNextStep(task('DISPUTED'), x)!.tone, 'signal');
  assert.equal(posterNextStep(task('COMPLETED'), x), null);
});

test('tabs and the 5-step track', () => {
  assert.deepEqual(['OPEN', 'LOCKED', 'DISPUTED', 'AUTO_COMPLETED', 'CANCELLED'].map(posterTabOf), [0, 1, 1, 2, 3]);
  assert.equal(posterStage('OPEN', 0), 1);
  assert.equal(posterStage('OPEN', 2), 2);
  assert.equal(posterStage('WORK_DONE', 0), 4);
  assert.equal(posterStage('CANCELLED', 0), 0);
});

test('worker needs: start, finish, then one row for offers waiting', () => {
  const rows = [
    { taskId: 'a', state: 'ACTIVE · TIMER RUNNING', title: 'Deliver lunch', act: 'active', meta: '' },
    { taskId: 'b', state: 'ACCEPTED · SWIPE TO START', title: 'Fix a fan', act: 'start', meta: 'Paid · first to start gets the job' },
    { taskId: 'c', state: 'WAITING ON PAYMENT', title: 'Tap', act: null, meta: '' },
  ];
  const needs = workerNeeds(rows, { dueOf: (id) => (id === 'a' ? new Date(2026, 10, 18, 13, 0).toISOString() : null), pendingOffers: 2, now: NOW });
  assert.deepEqual(needs.map((n) => n.kind), ['start', 'finish', 'offers']);
  assert.equal(needs[1]!.hint, 'Due today 1 pm');
  assert.equal(needs[2]!.lead, '2 offers waiting for an answer');
});

test('worker track, next step and button', () => {
  assert.equal(workerStage('PENDING'), 1);
  assert.equal(workerStage('WAITING ON PAYMENT'), 2);
  assert.equal(workerStage('DONE · PAID'), 5);
  assert.equal(workerStage('NOT SELECTED'), 0);
  const row = (state: string) => ({ state, title: 't', act: null, meta: '' });
  assert.equal(workerNextStep(row('WAITING ON PAYMENT'), null, NOW)!.tone, 'signal');
  assert.equal(workerNextStep(row('ACTIVE · TIMER RUNNING'), { status: 'TASK_STARTED' }, NOW)!.timer, true);
  assert.equal(workerButton('WAITING ON PAYMENT'), null);
  assert.equal(workerButton('ACCEPTED · SWIPE TO START')!.kind, 'swipe');
});

test('the customer is named only once the job has started', () => {
  assert.equal(customerShown({ status: 'LOCKED' }), false);
  assert.equal(customerShown({ status: 'LOCKED', started_at: 'x' }), true);
  assert.equal(customerShown({ status: 'WORK_DONE' }), true);
});

test('closed line: nothing charged, refund pending, refunded less the fine', () => {
  const x = { money, fineMinor: 2000, finePct: 5 };
  assert.equal(closedLine(task('CANCELLED'), x), '₹0 charged · closed before you paid');
  assert.match(closedLine(task('CANCELLED', { funded_at: 'x' }), x), /being processed/);
  assert.equal(closedLine(task('CANCELLED', { funded_at: 'x', wallet_refunded_at: 'y', funded_minor: 41200 }), x), '₹412 refunded to you');
  assert.equal(
    closedLine(task('CANCELLED', { funded_at: 'x', wallet_refunded_at: 'y', started_at: 'z', funded_minor: 41200 }), x),
    '₹392 refunded to you · less the 5% fine',
  );
});

test('small words', () => {
  assert.equal(firstName('Ravi Kumar'), 'Ravi');
  assert.equal(firstName('  '), null);
  assert.equal(dueIn(new Date(NOW + 3 * 86_400_000).toISOString(), NOW), 'in 3 days');
  assert.equal(dueIn(new Date(NOW - 1).toISOString(), NOW), 'passed');
  assert.equal(elapsed(new Date(NOW - (3600 + 24 * 60 + 10) * 1000).toISOString(), NOW), '01:24:10');
});

// ---- new task cards (1.19 row G) ----

test('status pill tones: moving, ringed (waiting on you), coral, grey; gold is never used', () => {
  assert.deepEqual(statusBadge({ status: 'LOCKED', funded_at: null }), { label: 'Waiting for payment', tone: 'you' });
  assert.equal(statusBadge({ status: 'WORK_DONE' }).tone, 'you');
  assert.equal(statusBadge({ status: 'TASK_STARTED' }).tone, 'accent');
  assert.equal(statusBadge({ status: 'OVERDUE' }).tone, 'signal');
  assert.equal(statusBadge({ status: 'DISPUTED' }).tone, 'signal');
  assert.equal(statusBadge({ status: 'REVISION_REQUESTED' }).tone, 'neutral');
  for (const s of ['OPEN', 'LOCKED', 'TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED', 'COMPLETED', 'DISPUTED', 'CANCELLED']) {
    for (const funded of [null, 'x']) {
      const tone = statusBadge({ status: s, funded_at: funded }).tone;
      assert.ok(tone !== 'gold' && tone !== 'blue', s);
    }
  }
});

test('poster pill: an open post says how its offers stand', () => {
  const future = new Date(NOW + 86_400_000).toISOString();
  const past = new Date(NOW - 86_400_000).toISOString();
  assert.deepEqual(posterPill({ status: 'OPEN', due_at: future }, 3, NOW), { label: '3 offers in', tone: 'moving' });
  assert.deepEqual(posterPill({ status: 'OPEN', due_at: future }, 1, NOW), { label: '1 offer in', tone: 'moving' });
  assert.deepEqual(posterPill({ status: 'OPEN', due_at: future }, 0, NOW), { label: 'Waiting for offers', tone: 'wait' });
  assert.deepEqual(posterPill({ status: 'OPEN', due_at: past }, 0, NOW), { label: 'Date passed', tone: 'wait' });
  assert.deepEqual(posterPill({ status: 'LOCKED', funded_at: null }, 0, NOW), { label: 'Waiting for payment', tone: 'you' });
  assert.deepEqual(posterPill({ status: 'WORK_DONE' }, 0, NOW), { label: 'Review work', tone: 'you' });
  assert.equal(posterPill({ status: 'DISPUTED' }, 0, NOW).tone, 'problem');
  assert.equal(posterPill({ status: 'CANCELLED' }, 0, NOW).tone, 'closed');
  assert.equal(posterPill({ status: 'COMPLETED' }, 0, NOW).tone, 'moving');
});

test('where line says Nearby with the area, or Remote', () => {
  assert.equal(whereLine('Home Services', 'Kondapur'), 'Home Services · Nearby · Kondapur');
  assert.equal(whereLine('Design', 'Remote'), 'Design · Remote');
  assert.equal(whereLine('Design', null), 'Design');
});

test('poster date line', () => {
  const due = new Date(2026, 10, 30, 12, 0).toISOString();
  assert.deepEqual(posterDateBits(task('OPEN', { due_at: due }), NOW, '2h ago'), [
    { t: 'Posted ' },
    { t: '2h ago', b: true },
    { t: ' · due ' },
    { t: 'Mon 30 Nov', b: true },
  ]);
  assert.deepEqual(posterDateBits(task('WORK_DONE', { auto_complete_at: new Date(2026, 10, 27, 9, 0).toISOString() }), NOW), [
    { t: 'Approve or report by ' },
    { t: 'Fri 27 Nov', b: true },
  ]);
  assert.deepEqual(posterDateBits(task('COMPLETED', { completed_at: new Date(2026, 10, 22, 9, 0).toISOString() }), NOW), [{ t: 'Finished ' }, { t: '22 Nov', b: true }]);
  assert.deepEqual(posterDateBits(task('CANCELLED'), NOW), [{ t: 'Closed' }]);
});

test('poster hint: only where it helps', () => {
  const x = { offers: 0, name: 'Farhan Ali', now: NOW };
  assert.equal(posterHint(task('LOCKED'), x)!.text, 'Farhan starts once you pay. TaskDrop holds the money until you approve.');
  assert.equal(posterHint(task('LOCKED', { funded_at: 'x' }), x), null);
  assert.equal(posterHint(task('TASK_STARTED'), x), null);
  assert.equal(posterHint(task('DISPUTED'), x)!.tone, 'coral');
  assert.equal(posterHint(task('OPEN', { due_at: new Date(NOW + 1000).toISOString() }), x), null);
  assert.equal(posterHint(task('OPEN', { due_at: new Date(NOW - 1000).toISOString() }), x)!.tone, 'mut');
});

test('worker pill words and tones', () => {
  assert.deepEqual(workerPill('PENDING'), { label: 'Offer sent', tone: 'wait' });
  assert.deepEqual(workerPill('ACCEPTED · SWIPE TO START'), { label: 'You’re picked', tone: 'moving' });
  assert.deepEqual(workerPill('ACTIVE · TIMER RUNNING', 'TASK_STARTED'), { label: 'Working', tone: 'moving' });
  assert.deepEqual(workerPill('ACTIVE · TIMER RUNNING', 'OVERDUE'), { label: 'Overdue', tone: 'problem' });
  assert.deepEqual(workerPill('WORK DONE · WAITING FOR CUSTOMER', 'WORK_DONE'), { label: 'Waiting for approval', tone: 'wait' });
  assert.deepEqual(workerPill('WORK DONE · WAITING FOR CUSTOMER', 'REVISION_REQUESTED'), { label: 'Changes asked', tone: 'you' });
  assert.deepEqual(workerPill('DONE · PAID'), { label: '✓ Paid', tone: 'moving' });
  assert.deepEqual(workerPill('NOT SELECTED'), { label: 'Not picked', tone: 'closed' });
});
