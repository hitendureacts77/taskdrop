/**
 * Tests for the server's shared answers (plan 3.5b, layer D): the memo with single-flight, and how runOp and
 * runGuestOp use it. Against fake databases; nothing here talks to a real one.
 *
 *   node --experimental-transform-types --no-warnings --test supabase/functions/api/publicMemo.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseControls } from "../_shared/controls.ts";
import type { Ctx, Db, DbResult } from "./core.ts";
import { runGuestOp } from "./guest.ts";
import { runOp } from "./ops.ts";
import { type MemoCounts, MEMO_MAX_ENTRIES, PUBLIC_MEMO_OPS, PublicMemo, type PublicMemoOp, noKeep, sharedAnswer } from "./publicMemo.ts";

const UID = "11111111-1111-4111-8111-111111111111";
const NIL = "00000000-0000-0000-0000-000000000000";
const TASK = "22222222-2222-4222-8222-222222222222";

/** A promise and the hand that settles it. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/** A fake database answering every rpc from `answer`, counting calls per function. */
function fakeDb(answer: (fn: string, args?: Record<string, unknown>) => DbResult | Promise<DbResult>) {
  const calls: string[] = [];
  const db: Db = {
    rpc: async (fn, args) => {
      calls.push(fn);
      return answer(fn, args);
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "in", "eq", "order", "limit"]) q[m] = () => q;
      q.then = (res: (v: DbResult) => unknown) => Promise.resolve({ data: [{ key: "promotion_durations_days", value: [1, 3] }], error: null }).then(res);
      return q;
    },
    storage: { from: () => ({}) },
  };
  return { db, calls };
}

const on = parseControls({ platform: "android", public_cache_memo: true })!;
const off = parseControls({ platform: "android", public_cache_memo: false })!;

const ctxFor = (db: Db, patch: Partial<Ctx> = {}): Ctx => ({ db, userId: UID, controls: on, ...patch });

test("single-flight: 20 callers asking at once cause one database call and get the same answer", async () => {
  const memo = new PublicMemo();
  const gate = deferred<unknown>();
  let loads = 0;
  const load = () => {
    loads++;
    return gate.promise;
  };
  const all = Array.from({ length: 20 }, () => memo.run("trendingCategories", { limit: 8 }, load));
  gate.resolve([{ category: "Cleaning", open_count: 3 }]);
  const answers = await Promise.all(all);
  assert.equal(loads, 1);
  for (const a of answers) assert.deepEqual(a, [{ category: "Cleaning", open_count: 3 }]);
  // And the answer is now kept.
  await memo.run("trendingCategories", { limit: 8 }, load);
  assert.equal(loads, 1);
});

test("single-flight through runOp: concurrent signed-in callers share one rpc", async () => {
  const memo = new PublicMemo();
  const gate = deferred<DbResult>();
  const f = fakeDb(() => gate.promise);
  const all = Array.from({ length: 10 }, () => runOp("platformHighlights", {}, ctxFor(f.db, { memo })));
  gate.resolve({ data: { activeNow: 4, openTasks: 9 }, error: null });
  const replies = await Promise.all(all);
  assert.equal(f.calls.length, 1);
  for (const r of replies) assert.equal(JSON.stringify(r), JSON.stringify({ ok: true, data: { activeNow: 4, openTasks: 9 } }));
});

test("TTL: each op's answer is kept for its own time, then asked again", async () => {
  let clock = 1_000_000;
  const memo = new PublicMemo({ now: () => clock });
  for (const op of Object.keys(PUBLIC_MEMO_OPS) as PublicMemoOp[]) {
    const ttl = PUBLIC_MEMO_OPS[op];
    assert.ok(ttl >= 15_000 && ttl <= 60_000);
    let loads = 0;
    const load = async () => ({ n: ++loads });
    assert.deepEqual(await memo.run(op, {}, load), { n: 1 });
    clock += ttl - 1;
    assert.deepEqual(await memo.run(op, {}, load), { n: 1 }, `${op} still kept just before ${ttl} ms`);
    clock += 1;
    assert.deepEqual(await memo.run(op, {}, load), { n: 2 }, `${op} asked again at ${ttl} ms`);
  }
});

test("an error is never kept, does not poison the callers waiting on it, and is cleared at once", async () => {
  const memo = new PublicMemo();
  const gate = deferred<unknown>();
  let loads = 0;
  const failing = () => {
    loads++;
    return loads === 1 ? gate.promise : Promise.resolve(["own answer"]);
  };
  const leader = memo.run("topEarners", { kind: "top_rated" }, failing);
  const waiters = Array.from({ length: 3 }, () => memo.run("topEarners", { kind: "top_rated" }, failing));
  gate.reject(new Error("database down"));
  await assert.rejects(leader, /database down/);
  // Each waiter asked for itself, as it would without the memo: the leader's error never reached them.
  for (const w of await Promise.all(waiters)) assert.deepEqual(w, ["own answer"]);
  assert.equal(loads, 4);
  // The failed flight is gone: the next caller starts a fresh one.
  let later = 0;
  await memo.run("topEarners", { kind: "top_rated" }, async () => ++later);
  assert.equal(later, 1);
});

test("an rpc error through runOp comes back as before and is never kept", async () => {
  const memo = new PublicMemo();
  let n = 0;
  const f = fakeDb(() => (++n === 1 ? { data: null, error: { message: "boom", code: "XX000" } } : { data: [{ category: "A" }], error: null }));
  const first = await runOp("trendingCategories", {}, ctxFor(f.db, { memo }));
  assert.equal(first.ok, false);
  const second = await runOp("trendingCategories", {}, ctxFor(f.db, { memo }));
  assert.deepEqual(second, { ok: true, data: [{ category: "A" }] });
  assert.equal(f.calls.length, 2, "the error was not kept");
  await runOp("trendingCategories", {}, ctxFor(f.db, { memo }));
  assert.equal(f.calls.length, 2, "the good answer was");
});

test("an empty fallback from an error path (adAuctionRanks' {}) is never kept", async () => {
  const memo = new PublicMemo();
  let n = 0;
  const f = fakeDb(() => (++n === 1 ? { data: null, error: { message: "boom" } } : { data: [{ task_id: TASK, rank: 1 }], error: null }));
  const first = await runOp("adAuctionRanks", {}, ctxFor(f.db, { memo }));
  assert.equal(JSON.stringify(first), JSON.stringify({ ok: true, data: {} }), "same bytes as today");
  assert.equal(memo.size, 0);
  const second = await runOp("adAuctionRanks", {}, ctxFor(f.db, { memo }));
  assert.deepEqual(second, { ok: true, data: { [TASK]: 1 } });
  assert.equal(f.calls.length, 2);
  // And straight through the memo: a value marked noKeep, or nothing at all, is handed back but never kept.
  let loads = 0;
  await memo.run("platformHighlights", {}, async () => (loads++, noKeep({})));
  await memo.run("platformHighlights", {}, async () => (loads++, null));
  await memo.run("platformHighlights", {}, async () => (loads++, undefined));
  await memo.run("platformHighlights", {}, async () => (loads++, { ok: 1 }));
  assert.equal(loads, 4);
  assert.equal(memo.size, 2, "only the adAuctionRanks answer and the real highlights are kept");
});

test("switch OFF (or unreadable, or no memo): every call reaches the database, exactly as before", async () => {
  for (const patch of [{ controls: off }, { controls: null }, { controls: undefined }, { memo: null }] as Partial<Ctx>[]) {
    const memo = new PublicMemo();
    const f = fakeDb(() => ({ data: { activeNow: 1 }, error: null }));
    const base = ctxFor(f.db, { memo, ...patch });
    const a = await runOp("platformHighlights", {}, base);
    const b = await runOp("platformHighlights", {}, base);
    const g = await runGuestOp("platformHighlights", {}, { ...base, userId: NIL });
    assert.equal(f.calls.length, 3, JSON.stringify(patch));
    assert.equal(memo.size, 0);
    assert.deepEqual(a, { ok: true, data: { activeNow: 1 } });
    assert.deepEqual(b, a);
    assert.deepEqual(g, a);
  }
  // Only the exact value true turns it on.
  for (const v of ["true", 1, null, undefined, {}]) assert.equal(parseControls({ public_cache_memo: v })!.public_cache_memo, false, String(v));
  assert.equal(parseControls({ public_cache_memo: true })!.public_cache_memo, true);
  assert.equal(parseControls({})!.public_cache_memo, false);
  // The other two switches never turn the memo on.
  const snapOnly = parseControls({ public_cache_snapshots: true, public_cache_app: true })!;
  assert.equal(snapOnly.public_cache_snapshots, true);
  assert.equal(snapOnly.public_cache_app, true);
  assert.equal(snapOnly.public_cache_memo, false);
});

test("an op not on the shared list is never memoized, even with the switch on", async () => {
  const memo = new PublicMemo();
  const f = fakeDb(() => ({ data: [{ id: "x" }], error: null }));
  for (let i = 0; i < 3; i++) await runOp("myStats", { role: "worker" }, ctxFor(f.db, { memo }));
  for (let i = 0; i < 3; i++) await runOp("listOpenTasks", {}, ctxFor(f.db, { memo }));
  // platform_stats is admin-only money totals: never shared, whoever asks.
  for (let i = 0; i < 3; i++) await runOp("platformStats", { days: 30 }, ctxFor(f.db, { memo }));
  assert.equal(f.calls.length, 9);
  assert.equal(Object.hasOwn(PUBLIC_MEMO_OPS, "platformStats"), false);
  assert.equal(memo.size, 0);
  // Called directly with a name off the list (or a prototype name), the memo still only passes through.
  let loads = 0;
  for (const name of ["getWallet", "listMyTasks", "__proto__", "toString"]) {
    await memo.run(name as PublicMemoOp, {}, async () => (loads++, { x: 1 }));
    await memo.run(name as PublicMemoOp, {}, async () => (loads++, { x: 1 }));
    await sharedAnswer(name, {}, { memo, controls: on }, async () => (loads++, { x: 1 }));
  }
  assert.equal(loads, 12);
  assert.equal(memo.size, 0);
});

test("bounded: never more than maxEntries answers, expired first, then the oldest", async () => {
  let clock = 0;
  const memo = new PublicMemo({ maxEntries: 3, now: () => clock });
  for (let i = 1; i <= 10; i++) await memo.run("trendingCategories", { limit: i }, async () => [i]);
  assert.equal(memo.size, 3);
  // The newest three are the ones kept.
  let loads = 0;
  assert.deepEqual(await memo.run("trendingCategories", { limit: 10 }, async () => (loads++, [0])), [10]);
  assert.deepEqual(await memo.run("trendingCategories", { limit: 1 }, async () => (loads++, [0])), [0]);
  assert.equal(loads, 1);
  // Expired answers make room before a live one is dropped.
  clock += 15_000; // adAuctionRanks (15 s) would be expired by now, trending (60 s) not
  const m2 = new PublicMemo({ maxEntries: 2, now: () => clock });
  await m2.run("adAuctionRanks", {}, async () => ({ a: 1 }));
  await m2.run("trendingCategories", {}, async () => [1]);
  clock += 15_000;
  await m2.run("topEarners", { kind: "top_rated" }, async () => [2]);
  let t = 0;
  await m2.run("trendingCategories", {}, async () => (t++, [9]));
  assert.equal(t, 0, "the live trending answer survived; the expired ad order made room");
  assert.equal(MEMO_MAX_ENTRIES, 500);
  // The default bound holds too.
  const big = new PublicMemo();
  for (let i = 0; i < MEMO_MAX_ENTRIES + 50; i++) await big.run("topEarners", { kind: "top_rated", junk: i }, async () => [i]);
  assert.equal(big.size, MEMO_MAX_ENTRIES);
});

test("guest and signed-in get identical bytes, and the key never carries who asked", async () => {
  const rows = [{ id: UID, display_name: "Asha", rating: 4.9, jobs_done: 12 }];
  // Signed in first, then a guest.
  {
    const memo = new PublicMemo();
    const signed = fakeDb(() => ({ data: rows, error: null }));
    const guestDb = fakeDb(() => ({ data: [{ different: true }], error: null }));
    const a = await runOp("topEarners", { kind: "top_rated" }, ctxFor(signed.db, { memo }));
    const b = await runGuestOp("topEarners", { kind: "top_rated" }, ctxFor(guestDb.db, { memo, userId: NIL }));
    assert.equal(JSON.stringify(b), JSON.stringify(a));
    assert.equal(guestDb.calls.length, 0, "the guest was served the shared answer");
  }
  // A guest first, then two different people.
  {
    const memo = new PublicMemo();
    const guestDb = fakeDb(() => ({ data: rows, error: null }));
    const other = fakeDb(() => ({ data: [{ different: true }], error: null }));
    const g = await runGuestOp("topEarners", { kind: "top_rated" }, ctxFor(guestDb.db, { memo, userId: NIL }));
    const p1 = await runOp("topEarners", { kind: "top_rated" }, ctxFor(other.db, { memo, userId: UID }));
    const p2 = await runOp("topEarners", { kind: "top_rated" }, ctxFor(other.db, { memo, userId: "99999999-9999-4999-8999-999999999999" }));
    assert.equal(JSON.stringify(p1), JSON.stringify(g));
    assert.equal(JSON.stringify(p2), JSON.stringify(g));
    assert.equal(other.calls.length, 0);
  }
  // Each caller gets its own copy: changing one answer never changes the next caller's.
  {
    const memo = new PublicMemo();
    const f = fakeDb(() => ({ data: { activeNow: 2 }, error: null }));
    const first = await runOp("platformHighlights", {}, ctxFor(f.db, { memo }));
    const hit = await runOp("platformHighlights", {}, ctxFor(f.db, { memo }));
    if (hit.ok) (hit.data as Record<string, unknown>).activeNow = 999;
    const again = await runOp("platformHighlights", {}, ctxFor(f.db, { memo }));
    assert.deepEqual(again, first);
  }
});

test("promotionTiers (signed in only) is shared too, through its settings read", async () => {
  const memo = new PublicMemo();
  const f = fakeDb(() => ({ data: null, error: null }));
  const a = await runOp("promotionTiers", {}, ctxFor(f.db, { memo }));
  const b = await runOp("promotionTiers", {}, ctxFor(f.db, { memo, userId: "99999999-9999-4999-8999-999999999999" }));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a, { ok: true, data: { budgetsMinor: null, days: [1, 3] } });
  assert.equal(f.calls.length, 1);
});

test("the switches still come first: maintenance refuses before any shared answer", async () => {
  const memo = new PublicMemo();
  const f = fakeDb(() => ({ data: { activeNow: 1 }, error: null }));
  await runOp("platformHighlights", {}, ctxFor(f.db, { memo }));
  const shut = parseControls({ public_cache_memo: true, maintenance: true })!;
  const r = await runOp("platformHighlights", {}, ctxFor(f.db, { memo, controls: shut }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "MAINTENANCE");
});

test("counts are reported per op, at most once a period, with numbers only", async () => {
  let clock = 0;
  const lines: [string, MemoCounts][] = [];
  const memo = new PublicMemo({ now: () => clock, report: (op, c) => lines.push([op, { ...c }]), reportEveryMs: 30_000 });
  const gate = deferred<unknown>();
  const shared = [memo.run("trendingCategories", { limit: 8 }, () => gate.promise), memo.run("trendingCategories", { limit: 8 }, () => gate.promise)];
  gate.resolve([1]);
  await Promise.all(shared);
  await memo.run("trendingCategories", { limit: 8 }, async () => [2]);
  await memo.run("adAuctionRanks", {}, async () => noKeep({}));
  assert.equal(lines.length, 0, "nothing before the period is up");
  clock += 30_000; // the period is up, the trending answer (60 s) is still kept
  await memo.run("trendingCategories", { limit: 8 }, async () => [3]);
  assert.deepEqual(Object.fromEntries(lines), {
    trendingCategories: { hit: 2, miss: 1, coalesced: 1, notKept: 0 },
    adAuctionRanks: { hit: 0, miss: 1, coalesced: 0, notKept: 1 },
  });
  // A report that throws never fails the call.
  const loud = new PublicMemo({ now: () => clock, report: () => { throw new Error("log down"); }, reportEveryMs: 0 });
  assert.deepEqual(await loud.run("platformHighlights", {}, async () => ({ a: 1 })), { a: 1 });
});
