/**
 * Leak tests for safe caching (plan 3.5b, task 8), with no network: the server's shared memo
 * (PublicMemo / sharedAnswer, supabase/functions/api/publicMemo.ts) and the app's reuse (freshness.ts) put
 * together, in front of fake fetchers for person A, person B and a guest. They prove that:
 *
 *   - a same-for-everyone read gives A, B and a guest the same bytes,
 *   - a per-person read is never handed to the next person after an account switch, even one still loading,
 *   - a money read (the wallet) is asked for every time with every switch ON, and shows a change at once,
 *   - with every switch OFF, every shared and money read reaches the fetcher.
 *
 * The staging run of the same checks is the cache section of scripts/two-person-test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEVER_REUSE, PER_PERSON_REUSE, PUBLIC_REUSE_MS, reusePublic, reuseWhileFresh, setPerson, setPublicCache } from './freshness.ts';
import { PUBLIC_MEMO_OPS, PublicMemo, sharedAnswer } from '../../../../supabase/functions/api/publicMemo.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
type Caller = typeof A | typeof B | 'guest';

/** Each person's private things, as the fake database holds them. */
const PEOPLE: Record<string, { phone: string; email: string; balanceMinor: number }> = {
  [A]: { phone: '9990000003', email: 'meera@example.test', balanceMinor: 12_345 },
  [B]: { phone: '9990000001', email: 'asha@example.test', balanceMinor: 67_890 },
};

/** Args each shared read is called with. */
const ARGS: Record<string, Record<string, unknown>> = {
  trendingCategories: { limit: 8 },
  topEarners: { kind: 'top_rated', limit: 10 },
  platformHighlights: {},
  promotionTiers: {},
  adAuctionRanks: {},
};

/**
 * A fake server: one memo for this "server copy", the memo switch, and a fake database that counts what it is
 * asked. Shared reads give the same rows to everyone (a fresh object each time, as a real query would);
 * per-person and money reads give the caller's own rows.
 */
function world(opts: { memoOn: boolean }) {
  let clock = 1_000_000;
  const now = () => clock;
  const memo = new PublicMemo({ now });
  const asked: Record<string, number> = {};
  const count = (k: string) => (asked[k] = (asked[k] ?? 0) + 1);

  const db = async (op: string, args: Record<string, unknown>, who: Caller): Promise<unknown> => {
    count(op);
    count(`${op}@${who}`);
    if (op in PUBLIC_MEMO_OPS) {
      // Same for everyone: nothing here depends on who asked.
      return { op, args, rows: [{ category: 'cleaning', open_count: 4 }, { category: 'tutoring', open_count: 2 }] };
    }
    if (who === 'guest') throw new Error('needs an account');
    const p = PEOPLE[who];
    if (op === 'getWallet') return { user_id: who, balance_minor: p.balanceMinor };
    if (op === 'getProfile') return { id: who, phone: p.phone, email: p.email };
    if (op === 'listMyTasks') return [{ id: `task-of-${who}`, poster_id: who }];
    throw new Error(`fake db has no ${op}`);
  };

  /** The server's door: shared reads through sharedAnswer (as runOp and runGuestOp do), everything else straight. */
  const serve = (op: string, args: Record<string, unknown>, who: Caller) =>
    sharedAnswer(op, args, { memo, controls: { public_cache_memo: opts.memoOn } }, () => db(op, args, who));

  let caller: Caller = 'guest';
  /** The app: signs in as someone (freshness.setPerson, as lib/gateway.ts does on every auth event). */
  const signInAs = (who: Caller) => {
    caller = who;
    setPerson(who === 'guest' ? null : who);
  };
  /** The app's read, the way the gateway picks the reuse helper for an op. */
  const read = (op: string, args: Record<string, unknown> = {}) => {
    const who = caller;
    const ask = () => serve(op, args, who);
    const key = JSON.stringify(args);
    return op in PUBLIC_REUSE_MS ? reusePublic(op, key, ask, clock) : reuseWhileFresh(op, key, ask, clock);
  };

  return { asked, serve, signInAs, read, tick: (ms: number) => (clock += ms), memo };
}

const bytes = (v: unknown) => JSON.stringify(v);

/** Every private thing of A and B, for the leak checks. */
const PRIVATE = [A, B, ...Object.values(PEOPLE).flatMap((p) => [p.phone, p.email, String(p.balanceMinor)])];
const privateIn = (v: unknown) => PRIVATE.filter((m) => bytes(v).includes(m));

test('the simulated op lists are the real ones', () => {
  assert.deepEqual(Object.keys(ARGS).sort(), Object.keys(PUBLIC_MEMO_OPS).sort(), 'a new shared read needs arguments in ARGS');
  assert.ok(NEVER_REUSE.has('getWallet'));
  assert.ok(PER_PERSON_REUSE.has('getProfile') && PER_PERSON_REUSE.has('listMyTasks'));
});

test('a shared read gives A, B and a guest the same bytes, with nothing private, at the server and in the app', async () => {
  setPublicCache(true);
  const w = world({ memoOn: true });
  for (const op of Object.keys(PUBLIC_MEMO_OPS)) {
    const args = ARGS[op];
    // Server alone: three callers at the same moment share one database call.
    const [sa, sb, sg] = await Promise.all([w.serve(op, args, A), w.serve(op, args, B), w.serve(op, args, 'guest')]);
    assert.equal(bytes(sb), bytes(sa), `${op}: B's server answer differs from A's`);
    assert.equal(bytes(sg), bytes(sa), `${op}: the guest's server answer differs from A's`);
    assert.equal(w.asked[op], 1, `${op}: the memo should have shared one call`);
    // Through the app, switching between the three people.
    const seen: Record<string, string> = {};
    for (const who of [A, B, 'guest'] as Caller[]) {
      w.signInAs(who);
      const v = await w.read(op, args);
      seen[who] = bytes(v);
      assert.deepEqual(privateIn(v), [], `${op}: ${who}'s answer carries something private`);
    }
    assert.equal(seen[B], seen[A], `${op}: B's app answer differs from A's`);
    assert.equal(seen.guest, seen[A], `${op}: the guest's app answer differs from A's`);
  }
  // A caller can never change what the next one is handed.
  const first = (await w.serve('trendingCategories', ARGS.trendingCategories, A)) as { rows: unknown[] };
  first.rows.length = 0;
  const second = (await w.serve('trendingCategories', ARGS.trendingCategories, B)) as { rows: unknown[] };
  assert.equal(second.rows.length, 2);
  setPublicCache(false);
});

test('after an account switch, B never gets A\'s per-person answers, even one that was still loading', async () => {
  setPublicCache(true);
  const w = world({ memoOn: true });
  w.signInAs(A);
  const aProfile = await w.read('getProfile', { userId: 'me' });
  const aTasks = await w.read('listMyTasks');
  assert.equal((aProfile as { id: string }).id, A);
  // Reused for A within the 30-second rule (decision 5): proves the memory is really there to leak from.
  await w.read('getProfile', { userId: 'me' });
  assert.equal(w.asked[`getProfile@${A}`], 1);

  w.signInAs(B);
  const bProfile = await w.read('getProfile', { userId: 'me' });
  const bTasks = await w.read('listMyTasks');
  assert.equal((bProfile as { id: string }).id, B);
  assert.ok(!bytes(bProfile).includes(A) && !bytes(bTasks).includes(A), 'B was handed something of A\'s');
  assert.notEqual(bytes(bTasks), bytes(aTasks));
  assert.equal(w.asked[`getProfile@${B}`], 1, 'B\'s read must reach the fetcher, not A\'s memory');

  // A read A started, still loading when the account switches, is never handed to B.
  w.signInAs(A);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = reuseWhileFresh('getProfile', JSON.stringify({}), async () => {
    await gate;
    return w.serve('getProfile', {}, A);
  });
  w.signInAs(B);
  const bSlow = await w.read('getProfile', {});
  release();
  await slow;
  assert.equal((bSlow as { id: string }).id, B);
  const bAgain = await w.read('getProfile', {});
  assert.equal((bAgain as { id: string }).id, B, 'A\'s late answer was kept for B');

  // Going back to the guest forgets B too.
  w.signInAs('guest');
  await assert.rejects(w.read('getProfile', {}), /needs an account/);
  setPublicCache(false);
});

test('the wallet is never served from reuse or the memo, even with every switch on, and shows a change at once', async () => {
  setPublicCache(true);
  const w = world({ memoOn: true });
  w.signInAs(A);
  const first = (await w.read('getWallet')) as { balance_minor: number };
  PEOPLE[A].balanceMinor += 500; // money moved between two reads a moment apart
  w.tick(1);
  const second = (await w.read('getWallet')) as { balance_minor: number };
  assert.equal(second.balance_minor, first.balance_minor + 500, 'an old balance was shown');
  assert.equal(w.asked.getWallet, 2);
  // Not even if something hands it to the shared helpers by mistake.
  await reusePublic('getWallet', '{}', () => w.serve('getWallet', {}, A));
  await w.memo.run('getWallet' as never, {}, () => w.serve('getWallet', {}, A));
  await w.memo.run('getWallet' as never, {}, () => w.serve('getWallet', {}, A));
  assert.equal(w.asked.getWallet, 5);
  assert.equal(w.memo.size, 0, 'the memo kept a money answer');
  // And B, right after A, gets B's own wallet.
  w.signInAs(B);
  const b = (await w.read('getWallet')) as { user_id: string };
  assert.equal(b.user_id, B);
  PEOPLE[A].balanceMinor -= 500;
  setPublicCache(false);
});

test('with every switch off, every shared and money read reaches the fetcher', async () => {
  setPublicCache(false);
  const w = world({ memoOn: false });
  w.signInAs(A);
  const ops = [...Object.keys(PUBLIC_MEMO_OPS), 'getWallet'];
  for (let i = 0; i < 3; i++) {
    for (const op of ops) {
      await w.read(op, ARGS[op] ?? {});
      await w.serve(op, ARGS[op] ?? {}, B);
    }
    w.tick(1);
  }
  for (const op of ops) assert.equal(w.asked[op], 6, `${op} was answered from a memory with every switch off`);
  assert.equal(w.memo.size, 0);
});
