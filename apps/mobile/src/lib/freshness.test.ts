import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH_FOR_MS, GUEST, NEVER_REUSE, PER_PERSON_REUSE, forgetEverything, isFresh, noteChange, personKey,
  rememberedCount, reuseWhileFresh, screenMayReuse, setPerson, stamp,
} from './freshness.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

test('a read stays fresh for a while, then goes stale', () => {
  const s = stamp(1_000);
  assert.equal(isFresh(s, 1_000), true);
  assert.equal(isFresh(s, 1_000 + FRESH_FOR_MS - 1), true);
  assert.equal(isFresh(s, 1_000 + FRESH_FOR_MS), false);
  assert.equal(isFresh(null, 1_000), false);
  // A clock that went backwards proves nothing.
  assert.equal(isFresh(s, 999), false);
});

test('any change makes every earlier read stale at once', () => {
  const s = stamp(5_000);
  noteChange();
  assert.equal(isFresh(s, 5_001), false);
  assert.equal(isFresh(stamp(5_001), 5_002), true);
});

test('nothing is remembered before the first session is known', async () => {
  // Runs before any setPerson in this file.
  assert.equal(personKey(), null);
  let asked = 0;
  const ask = async () => ++asked;
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', ask, 1_000), 1);
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', ask, 1_001), 2);
  assert.equal(rememberedCount(), 0);
});

test('a fresh answer is reused, a stale or changed one is asked again', async () => {
  setPerson(A);
  let asked = 0;
  const ask = async () => ++asked;
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', ask, 10_000), 1);
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', ask, 10_000 + 1_000), 1);
  assert.equal(await reuseWhileFresh('countUnreadFor', 'worker', ask, 10_000 + 1_000), 2);
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', ask, 10_000 + FRESH_FOR_MS), 3);
  noteChange();
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', ask, 10_000 + FRESH_FOR_MS + 1), 4);
});

test('a failed answer is not kept', async () => {
  setPerson(A);
  let asked = 0;
  const ask = async () => {
    asked += 1;
    if (asked === 1) throw new Error('offline');
    return asked;
  };
  await assert.rejects(reuseWhileFresh('countNeedsAttention', 'poster', ask, 50_000));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await reuseWhileFresh('countNeedsAttention', 'poster', ask, 50_001), 2);
});

test("person A's answer is never served to person B or to a guest after a switch", async () => {
  setPerson(A);
  const answerFor = (who: string) => async () => `count of ${who}`;
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', answerFor('A'), 100_000), 'count of A');
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', answerFor('wrong'), 100_001), 'count of A');

  setPerson(B);
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', answerFor('B'), 100_002), 'count of B');

  setPerson(null);
  assert.equal(personKey(), GUEST);
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', answerFor('guest'), 100_003), 'count of guest');

  // Back to A within the 30 seconds: A's earlier answer was wiped, so A is asked again too.
  setPerson(A);
  assert.equal(await reuseWhileFresh('countUnreadFor', 'poster', answerFor('A again'), 100_004), 'count of A again');
});

test('a switch empties the memory, not only marks it stale; the same person again keeps it', async () => {
  setPerson(A);
  await reuseWhileFresh('countUnreadFor', 'poster', async () => 1, 200_000);
  assert.ok(rememberedCount() > 0);
  // A token renewal reports the same person: nothing is lost.
  setPerson(A);
  assert.ok(rememberedCount() > 0);
  setPerson(B);
  assert.equal(rememberedCount(), 0);
});

test('signing out (or deleting the account) empties every memory, including registered ones', async () => {
  setPerson(A);
  await reuseWhileFresh('countUnreadFor', 'worker', async () => 1, 300_000);
  assert.ok(rememberedCount() > 0);
  setPerson(null);
  assert.equal(rememberedCount(), 0);

  setPerson(A);
  await reuseWhileFresh('countUnreadFor', 'worker', async () => 1, 300_001);
  forgetEverything();
  assert.equal(rememberedCount(), 0);
});

test('a NEVER_REUSE op is never answered from memory, nor is an op on no list', async () => {
  setPerson(A);
  for (const op of [...NEVER_REUSE, 'someNewOp']) {
    let asked = 0;
    const ask = async () => ++asked;
    assert.equal(await reuseWhileFresh(op, '', ask, 400_000), 1, op);
    assert.equal(await reuseWhileFresh(op, '', ask, 400_001), 2, op);
  }
  assert.equal(rememberedCount(), 0);
});

test('the closed lists do not overlap, and the wallet is never reusable', () => {
  for (const op of NEVER_REUSE) assert.equal(PER_PERSON_REUSE.has(op), false, op);
  assert.ok(NEVER_REUSE.has('getWallet'));
  assert.equal(screenMayReuse('wallet'), false);
  assert.equal(screenMayReuse('home'), true);
  assert.equal(screenMayReuse(undefined), true);
});
