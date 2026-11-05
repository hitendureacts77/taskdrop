import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRESH_FOR_MS, GUEST, NEVER_REUSE, PER_PERSON_REUSE, forgetEverything, isFresh, noteChange, personKey,
  PUBLIC_REUSE_MS, publicCacheEnabled, rememberedCount, reusePublic, reuseWhileFresh, screenMayReuse, setPerson,
  setPublicCache, stamp,
} from './freshness.ts';
import { PUBLIC_MEMO_OPS } from '../../../../supabase/functions/api/publicMemo.ts';

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

// ---------------------------------------------- same-for-everyone reads (3.5b, layer A) --

const counter = (fail = 0) => {
  let asked = 0;
  const ask = async () => {
    asked += 1;
    if (asked <= fail) throw new Error('offline');
    return [asked];
  };
  return { ask, asked: () => asked };
};

test('the app list of shared reads is the server list, never longer than the server keeps them', () => {
  assert.deepEqual(Object.keys(PUBLIC_REUSE_MS).sort(), Object.keys(PUBLIC_MEMO_OPS).sort());
  for (const [op, ms] of Object.entries(PUBLIC_REUSE_MS)) {
    assert.ok(ms <= (PUBLIC_MEMO_OPS as Record<string, number>)[op], op);
    assert.ok(ms >= 15_000 && ms <= 60_000, op);
    assert.equal(NEVER_REUSE.has(op), false, op);
    assert.equal(PER_PERSON_REUSE.has(op), false, op);
  }
});

test('switch off (the default): shared reads are never reused', async () => {
  setPerson(A);
  setPublicCache(false);
  assert.equal(publicCacheEnabled(), false);
  const c = counter();
  await reusePublic('trendingCategories', '{"limit":8}', c.ask, 1_000_000);
  await reusePublic('trendingCategories', '{"limit":8}', c.ask, 1_000_001);
  assert.equal(c.asked(), 2);
  assert.equal(rememberedCount(), 0);
});

test('switch on: reused within the time, asked again after it, by arguments and by person', async () => {
  setPerson(A);
  setPublicCache(true);
  const c = counter();
  const ttl = PUBLIC_REUSE_MS.trendingCategories;
  assert.deepEqual(await reusePublic('trendingCategories', '{"limit":8}', c.ask, 2_000_000), [1]);
  assert.deepEqual(await reusePublic('trendingCategories', '{"limit":8}', c.ask, 2_000_000 + ttl - 1), [1]);
  assert.equal(c.asked(), 1);
  // different arguments are a different answer
  assert.deepEqual(await reusePublic('trendingCategories', '{"limit":5}', c.ask, 2_000_001), [2]);
  // the time is up
  assert.deepEqual(await reusePublic('trendingCategories', '{"limit":8}', c.ask, 2_000_000 + ttl), [3]);
  // each op has its own time
  const ad = counter();
  await reusePublic('adAuctionRanks', '{}', ad.ask, 3_000_000);
  await reusePublic('adAuctionRanks', '{}', ad.ask, 3_000_000 + PUBLIC_REUSE_MS.adAuctionRanks - 1);
  assert.equal(ad.asked(), 1);
  await reusePublic('adAuctionRanks', '{}', ad.ask, 3_000_000 + PUBLIC_REUSE_MS.adAuctionRanks);
  assert.equal(ad.asked(), 2);
  // nobody else sees person A's copy
  setPerson(B);
  assert.equal(rememberedCount(), 0);
  const other = counter();
  await reusePublic('trendingCategories', '{"limit":8}', other.ask, 2_000_002);
  assert.equal(other.asked(), 1);
  setPublicCache(false);
});

test('a write or a ping does not matter to a shared read, a wipe does', async () => {
  setPerson(A);
  setPublicCache(true);
  const c = counter();
  await reusePublic('platformHighlights', '{}', c.ask, 4_000_000);
  noteChange();
  await reusePublic('platformHighlights', '{}', c.ask, 4_000_001);
  assert.equal(c.asked(), 1);
  forgetEverything();
  await reusePublic('platformHighlights', '{}', c.ask, 4_000_002);
  assert.equal(c.asked(), 2);
  setPublicCache(false);
});

test('a failed answer is not kept; neither is an empty one', async () => {
  setPerson(A);
  setPublicCache(true);
  const f = counter(1);
  await assert.rejects(reusePublic('topEarners', '{"kind":"top_rated","limit":10}', f.ask, 5_000_000));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(rememberedCount(), 0);
  assert.deepEqual(await reusePublic('topEarners', '{"kind":"top_rated","limit":10}', f.ask, 5_000_001), [2]);
  assert.deepEqual(await reusePublic('topEarners', '{"kind":"top_rated","limit":10}', f.ask, 5_000_002), [2]);
  assert.equal(f.asked(), 2);

  for (const empty of [null, undefined, [], {}]) {
    let asked = 0;
    const ask = async () => (asked += 1, empty);
    await reusePublic('platformHighlights', '{}', ask, 5_100_000);
    await new Promise((r) => setTimeout(r, 0));
    await reusePublic('platformHighlights', '{}', ask, 5_100_001);
    assert.equal(asked, 2, JSON.stringify(empty));
  }
  setPublicCache(false);
});

test('NEVER_REUSE ops, per-person ops and unknown ops are never reused even with the switch on', async () => {
  setPerson(A);
  setPublicCache(true);
  for (const op of [...NEVER_REUSE, ...PER_PERSON_REUSE, 'someNewOp']) {
    const c = counter();
    await reusePublic(op, '{}', c.ask, 6_000_000);
    await reusePublic(op, '{}', c.ask, 6_000_001);
    assert.equal(c.asked(), 2, op);
  }
  assert.equal(rememberedCount(), 0);
  setPublicCache(false);
});

test('nothing shared is kept before the first session is known; sign-out and the switch going off wipe it', async () => {
  setPerson(A);
  setPublicCache(true);
  const c = counter();
  await reusePublic('promotionTiers', '{}', c.ask, 7_000_000);
  assert.equal(rememberedCount(), 1);
  // a per-person memory survives the switch going off; the shared one does not
  await reuseWhileFresh('countUnreadFor', 'poster', async () => 1, 7_000_000);
  setPublicCache(false);
  assert.equal(rememberedCount(), 1);
  setPublicCache(true);
  await reusePublic('promotionTiers', '{}', c.ask, 7_000_001);
  assert.equal(c.asked(), 2);
  // signing out empties them (the guest key is a different person)
  setPerson(null);
  assert.equal(rememberedCount(), 0);
  const g = counter();
  await reusePublic('promotionTiers', '{}', g.ask, 7_000_002);
  assert.equal(g.asked(), 1);
  setPerson(A);
  assert.equal(rememberedCount(), 0);
  setPublicCache(false);
});
