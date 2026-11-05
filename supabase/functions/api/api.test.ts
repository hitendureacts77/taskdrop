/**
 * Tests for the api function's operations, against a fake database.
 *
 * Run from the repo root with Node 22+:
 *   node --experimental-transform-types --no-warnings supabase/functions/api/api.test.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GUEST_OPS, NEEDS_ACCOUNT, NEEDS_ACCOUNT_CODE, guestAddress, guestRateKey, isGuestOp, isGuestToken, runGuestBatch, runGuestOp } from "./guest.ts";
import { WRITE_OPS } from "./writes.ts";
import { MEDIA_OPS } from "./media.ts";
import { MAX_BATCH, OPS, RATE_LIMITS, RecentlyLimited, batchCalls, rateBucket, rateCost, runBatch, runOp, spendRate } from "./ops.ts";
import {
  ControlsCache, featureOffMessage, OPEN_CONFIG, parseControls, publicConfig, readClient, refusalFor, type Controls,
} from "../_shared/controls.ts";
import { StandingCache, callerFromClaims, cutoffOf, endedBefore, standingOf, tokenFacts } from "./core.ts";
import { MAX_BODY_BYTES, REQUEST_ID_HEADER, readBody, requestIdFrom, withGatewayHeaders } from "./http.ts";
import {
  IN_PROGRESS, KEY_REUSED, OUTCOME_UNKNOWN, REPEAT_KEY_HEADER, type RepeatStore, repeatKeyFrom, requestHash, runOnce, stableJson as repeatStableJson,
} from "./repeat.ts";
import * as serverRules from "../_shared/rules.ts";
import type { ImageKitConfig } from "../_shared/imagekit.ts";
import { createHmac } from "node:crypto";
import * as packageRules from "../../../packages/rules/src/index.ts";
import { BATCHABLE_OPS } from "../../../apps/mobile/src/lib/batcher.ts";

const UID = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const TASK = "22222222-2222-4222-8222-222222222222";
const TASK2 = "44444444-4444-4444-8444-444444444444";
const BID = "33333333-3333-4333-8333-333333333333";

type Step = [string, unknown[]];
type Call = { table?: string; rpc?: string; args?: unknown; steps: Step[]; bucket?: string };
type Reply = { data: unknown; error: unknown; count?: number | null };

/** A fake client: records every query, and answers each from `answer(call)` when awaited. */
function fake(answer: (c: Call) => Reply = () => ({ data: [{ id: "row" }], error: null })) {
  const calls: Call[] = [];
  const chain = (rec: Call) => {
    const p: unknown = new Proxy(function () {}, {
      get(_t, name) {
        if (name === "then") return (res: (v: Reply) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(() => answer(rec)).then(res, rej);
        return (...args: unknown[]) => {
          rec.steps.push([String(name), args]);
          return p;
        };
      },
    });
    return p;
  };
  const storageCalls: Call[] = [];
  const db = {
    from: (table: string) => {
      const rec: Call = { table, steps: [] };
      calls.push(rec);
      return chain(rec);
    },
    rpc: async (fn: string, args?: unknown) => {
      const rec: Call = { rpc: fn, args, steps: [] };
      calls.push(rec);
      return answer(rec);
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => {
          storageCalls.push({ bucket, steps: [["createSignedUploadUrl", [path]]] });
          return { data: { signedUrl: `https://x/upload/${path}?token=t` }, error: null };
        },
        createSignedUrls: async (paths: string[]) => {
          storageCalls.push({ bucket, steps: [["createSignedUrls", [paths]]] });
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://x/sign/${p}` })), error: null };
        },
        remove: async (paths: string[]) => {
          storageCalls.push({ bucket, steps: [["remove", [paths]]] });
          return { data: null, error: null };
        },
      }),
    },
  };
  return { calls, storageCalls, db };
}

const ctx = (f: ReturnType<typeof fake>, extra: Record<string, unknown> = {}) =>
  ({ db: f.db as never, userId: UID, now: () => new Date("2026-10-05T10:00:00Z"), ...extra });
const steps = (c: Call, name: string) => c.steps.filter(([n]) => n === name).map(([, a]) => a);
const inserted = (c: Call) => steps(c, "insert")[0][0] as Record<string, unknown>;

let passed = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("ok  -", name);
}

// ------------------------------------------------------------------ surface --

await t("every operation the app asks for exists on the server", () => {
  const root = join(import.meta.dirname, "../../../apps/mobile/src");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) files.push(p);
    }
  };
  walk(root);
  const asked = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(?:act|ask|quietly|callApi)(?:<[^>()]*(?:<[^>]*>[^>()]*)*>)?\(\s*'([A-Za-z]+)'/g)) asked.add(m[1]);
  }
  assert.ok(asked.size > 80, `found only ${asked.size} op names; the scan is broken`);
  const missing = [...asked].filter((n) => !Object.prototype.hasOwnProperty.call(OPS, n));
  assert.deepEqual(missing, [], `the app calls ops the server lacks: ${missing.join(", ")}`);
});

await t("the server's copy of the money rules matches packages/rules", () => {
  assert.deepEqual({ ...serverRules.FEES }, {
    WORKER_COMMISSION_PCT: packageRules.FEES.WORKER_COMMISSION_PCT,
    POSTER_SERVICE_FEE_PCT: packageRules.FEES.POSTER_SERVICE_FEE_PCT,
    POST_START_CANCEL_PENALTY_PCT: packageRules.FEES.POST_START_CANCEL_PENALTY_PCT,
  });
  for (const v of [0, 1, 99, 1000, 12345, 999999]) assert.equal(serverRules.workerNetPayout(v), packageRules.workerNetPayout(v));
  const a = { lat: 17.44, lng: 78.35 }, b = { lat: 17.39, lng: 78.49 };
  assert.equal(serverRules.distanceKm(a, b), packageRules.distanceKm(a, b));
  assert.equal(serverRules.distanceKm(a, { lat: null, lng: 1 }), null);
});

await t("unknown and prototype op names are refused", async () => {
  for (const name of ["nope", "__proto__", "toString", "constructor", undefined, 42]) {
    const r = await runOp(name, {}, ctx(fake()));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "UNKNOWN_OP");
  }
});

// ------------------------------------------------------------- identity --

await t("writes take the caller from the session, never from the request", async () => {
  let f = fake();
  await runOp("placeBid", { taskId: TASK, workerId: OTHER, priceMinor: 5000, timeLimitMinutes: 60, message: " hi " }, ctx(f));
  assert.equal(inserted(f.calls[0]).worker_id, UID);
  assert.equal(inserted(f.calls[0]).message, "hi");

  f = fake();
  await runOp("createTask", { posterId: OTHER, pillar: "services", title: "Fix tap", benchmarkMinor: 5000, timeLimitMinutes: 30 }, ctx(f));
  assert.equal(inserted(f.calls[0]).poster_id, UID);

  f = fake();
  await runOp("sendMessage", { taskId: TASK, senderId: OTHER, body: "yo" }, ctx(f));
  assert.equal(inserted(f.calls[0]).sender_id, UID);

  f = fake();
  await runOp("addPayoutDestination", { kind: "bank", accountName: "A B", accountNumber: "123", ifsc: " hdfc0001234 ", user_id: OTHER }, ctx(f));
  assert.equal(inserted(f.calls[0]).user_id, UID);
  assert.equal(inserted(f.calls[0]).ifsc, "HDFC0001234");
});

await t("'my' reads filter on the session id even when the app sends another", async () => {
  for (const [op, col] of [["listMyTasks", "poster_id"], ["listMyBids", "worker_id"], ["listMyAssignments", "worker_id"], ["getWallet", "user_id"], ["listPayouts", "user_id"], ["listNotifications", "user_id"]] as const) {
    const f = fake(() => ({ data: [], error: null }));
    await runOp(op, { userId: OTHER }, ctx(f));
    assert.deepEqual(steps(f.calls[0], "eq").find(([c]) => c === col), [col, UID], op);
  }
});

await t("profile edits only touch the caller's row, and only known columns", async () => {
  const f = fake(() => ({ data: [{ id: UID }], error: null }));
  await runOp("updateProfile", { displayName: "Ann", onboarded: true, rating: 5, id: OTHER }, ctx(f));
  const patch = steps(f.calls[0], "update")[0][0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(patch).sort(), ["display_name", "onboarded_at"]);
  assert.deepEqual(steps(f.calls[0], "eq")[0], ["id", UID]);
});

await t("the legacy payout_upi is never written (migration 073 closed the column)", async () => {
  const f = fake(() => ({ data: [{ id: UID }], error: null }));
  await runOp("updateProfile", { displayName: "Ann", payoutUpi: "ann@upi" }, ctx(f));
  const patch = steps(f.calls[0], "update")[0][0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(patch), ["display_name"]);
});

await t("contact details are refused on the server, whatever the app does (Phase 3)", async () => {
  const PHONE = "call me on 98765 43210";
  const refused = async (op: string, args: Record<string, unknown>, f = fake()) => {
    const r = await runOp(op, args, ctx(f));
    assert.equal(r.ok, false, op);
    if (!r.ok) assert.equal(r.error.code, "CONTACT_DETAILS", op);
    assert.equal(f.calls.length, 0, op + " must not reach the database");
  };
  await refused("placeBid", { taskId: TASK, priceMinor: 5000, timeLimitMinutes: 60, message: PHONE });
  await refused("updateBid", { bidId: BID, priceMinor: 5000, timeLimitMinutes: 60, message: "mail me a@b.com" });
  await refused("createTask", { pillar: "services", title: "Fix tap", benchmarkMinor: 5000, timeLimitMinutes: 30, description: PHONE });
  await refused("createTask", { pillar: "services", title: "Fix tap at flat 12B", benchmarkMinor: 5000, timeLimitMinutes: 30 });
  await refused("updateListing", { id: TASK, title: "Tap repair", description: "www.example.com", priceMinor: 100, deliveryDays: 1 });
  await refused("submitProof", { taskId: TASK, summary: PHONE, files: [] });
  await refused("updateProfile", { displayName: "98765 43210 ravi" });
  await refused("updateProfileExtras", { bio: PHONE });
  await refused("updateProfileExtras", { workerBio: PHONE });
  await refused("updateProfileExtras", { username: "a@b.com" });
  // Ordinary text goes through, and the app's own already-masked text is fine.
  const f = fake(() => ({ data: [{ id: "row" }], error: null }));
  const ok = await runOp("placeBid", { taskId: TASK, priceMinor: 5000, timeLimitMinutes: 60, message: "Can do it tomorrow, ••• for details" }, ctx(f));
  assert.equal(ok.ok, true);
});

await t("chat: contact details are refused until the work starts, and allowed after", async () => {
  const early = fake((c) => (c.table === "tasks" ? { data: [{ status: "LOCKED" }], error: null } : { data: { id: "m" }, error: null }));
  const r = await runOp("sendMessage", { taskId: TASK, body: "my number is 98765 43210" }, ctx(early));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "CONTACT_DETAILS");
  assert.equal(early.calls.some((c) => c.table === "messages"), false);

  const started = fake((c) => (c.table === "tasks" ? { data: [{ status: "TASK_STARTED" }], error: null } : { data: { id: "m" }, error: null }));
  const ok = await runOp("sendMessage", { taskId: TASK, body: "my number is 98765 43210" }, ctx(started));
  assert.equal(ok.ok, true);

  // Plain chat does not even look the task up.
  const plain = fake(() => ({ data: { id: "m" }, error: null }));
  await runOp("sendMessage", { taskId: TASK, body: "On my way" }, ctx(plain));
  assert.deepEqual(plain.calls.map((c) => c.table), ["messages"]);
});

await t("the feed never offers the caller their own posts, nor expired ones", async () => {
  const f = fake(() => ({ data: [], error: null }));
  await runOp("listOpenTasks", { kind: "request" }, ctx(f));
  assert.deepEqual(steps(f.calls[0], "neq")[0], ["poster_id", UID]);
  assert.deepEqual(steps(f.calls[0], "or")[0], ["due_at.is.null,due_at.gt.2026-10-05T10:00:00.000Z"]);
});

// ------------------------------------------------------------- validation --

await t("bad ids and out-of-range values never reach the database", async () => {
  const f = fake();
  const bad = async (op: string, args: Record<string, unknown>) => {
    const r = await runOp(op, args, ctx(f));
    assert.equal(r.ok, false, op);
    if (!r.ok) assert.equal(r.error.code, "BAD_ARGS", op);
  };
  await bad("startTask", { taskId: "not-a-uuid" });
  await bad("submitReview", { taskId: TASK, rating: 6 });
  await bad("startPromotion", { taskId: TASK, days: 31, amountMinor: 10 });
  await bad("requestWithdrawal", { amountMinor: -5 });
  await bad("createTask", { pillar: "x", title: "t", benchmarkMinor: 1, timeLimitMinutes: 1, media: { kind: "image", path: `${OTHER}/a.jpg` } });
  await bad("countBidsByTask", { taskIds: ["x"] });
  await bad("searchTasks", { near: { lat: 999, lng: 0, radiusKm: 1 } });
  assert.equal(f.calls.length, 0);
});

await t("search text cannot break out of the filter grammar", async () => {
  const f = fake(() => ({ data: [], error: null }));
  await runOp("searchTasks", { q: "tap),status.eq.CANCELLED,(title" }, ctx(f));
  const ors = steps(f.calls[0], "or").map(([x]) => String(x));
  assert.ok(ors[1].startsWith("title.ilike.%") && !/[(),]/.test(ors[1].replace(/^title\.ilike\.%|,description\.ilike\.%|%$/g, "").replace(/%,description\.ilike\.%/, "")), ors[1]);
});

await t("searchTasksWithPosters answers what searchTasks then attachPosters would, in one call", async () => {
  const tasks = [
    { id: TASK, poster_id: OTHER, status: "OPEN", loc_lat: null, loc_lng: null },
    { id: TASK2, poster_id: OTHER, status: "OPEN", loc_lat: null, loc_lng: null },
  ];
  const f = fake((c) => (c.table === "profiles" ? { data: [{ id: OTHER, display_name: "Ravi" }], error: null } : { data: tasks, error: null }));
  const r = await runOp("searchTasksWithPosters", { q: "tap", limit: 60, kind: "request" }, ctx(f));
  assert.ok(r.ok);
  const out = r.data as Array<{ id: string; poster: { id: string } | null }>;
  assert.deepEqual(out.map((x) => [x.id, x.poster?.id]), [[TASK, OTHER], [TASK2, OTHER]]);
  // Same filters as searchTasks (never the caller's own posts), and one profiles read for both tasks.
  assert.deepEqual(steps(f.calls[0], "neq")[0], ["poster_id", UID]);
  assert.equal(f.calls.filter((c) => c.table === "profiles").length, 1);
  assert.equal(rateBucket("searchTasksWithPosters"), "read");
  // Bad arguments are refused the same way, before the database is asked.
  const g = fake();
  const bad = await runOp("searchTasksWithPosters", { near: { lat: 999, lng: 0, radiusKm: 1 } }, ctx(g));
  assert.ok(!bad.ok && bad.error.code === "BAD_ARGS");
  assert.equal(g.calls.length, 0);
  // Nothing found: no profiles read.
  const h = fake(() => ({ data: [], error: null }));
  assert.deepEqual((await runOp("searchTasksWithPosters", {}, ctx(h))).ok, true);
  assert.equal(h.calls.filter((c) => c.table === "profiles").length, 0);
});

// ------------------------------------------------------- safe error text --

await t("a message a SQL function wrote on purpose passes through, with its detail", async () => {
  const r = await runOp("lockBid", { bidId: BID }, ctx(fake(() => ({ data: null, error: { message: "Not enough money in your wallet", code: "P0001", details: "2500" } }))));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.message, "Not enough money in your wallet");
    assert.equal(r.error.details, "2500");
  }
});

await t("internal database wording never leaves the server", async () => {
  const leaky = [
    { message: 'new row violates row-level security policy for table "bids"', code: "42501", details: null },
    { message: 'duplicate key value violates unique constraint "bids_task_worker_key"', code: "23505", details: "Key (task_id, worker_id)=(a, b) already exists." },
    { message: 'relation "secret_table" does not exist', code: "42P01", details: "internal" },
  ];
  for (const err of leaky) {
    for (const [op, args] of [["startTask", { taskId: TASK }], ["listMyTasks", {}], ["getTaskDetail", { taskId: TASK }]] as const) {
      const r = await runOp(op, args, ctx(fake(() => ({ data: null, error: err }))));
      const text = JSON.stringify(r);
      assert.equal(r.ok, false);
      for (const word of ["bids", "policy", "constraint", "secret_table", "Key (", "internal"]) {
        assert.ok(!text.includes(word), `${op} leaked "${word}" in ${text}`);
      }
    }
  }
});

await t("refused quotes and username clashes are worded for people", async () => {
  const rls = await runOp("placeBid", { taskId: TASK, priceMinor: 2000, timeLimitMinutes: 1 }, ctx(fake(() => ({ data: null, error: { message: 'new row violates row-level security policy for table "bids"', code: "42501" } }))));
  assert.ok(!rls.ok && /your own request, or it is no longer open/.test(rls.error.message));
  const dup = await runOp("updateProfileExtras", { username: "ann" }, ctx(fake(() => ({ data: null, error: { message: 'duplicate key value violates unique constraint "profiles_username_key"', code: "23505" } }))));
  assert.ok(!dup.ok && dup.error.message === "That username is taken");
});

await t("an unexpected crash is hidden and reported", async () => {
  const boom = { rpc: async () => { throw new Error("secret stack detail"); }, from: () => { throw new Error("x"); }, storage: { from: () => ({}) } };
  let seen: unknown = null;
  const r = await runOp("startTask", { taskId: TASK }, { db: boom as never, userId: UID }, (e) => { seen = e; });
  assert.ok(!r.ok && r.error.code === "INTERNAL");
  assert.ok(!JSON.stringify(r).includes("secret"));
  assert.ok(seen instanceof Error);
});

// -------------------------------------------------------------- logic moved --

await t("wallet activity is assembled on the server, newest first", async () => {
  const f = fake((c) => {
    if (c.table === "assignments") return { data: [{ id: "a1", status: "released", escrow_minor: 10300, updated_at: "2026-10-01T00:00:00Z", tasks: { title: "Paint" } }], error: null };
    if (c.table === "tasks") return { data: [
      { id: "t1", title: "Fix", status: "COMPLETED", locked_minor: 1000, updated_at: "2026-10-03T00:00:00Z", funded_at: "x", funded_minor: 1030, wallet_refunded_at: null, assignments: [] },
      { id: "t2", title: "Unpaid", status: "LOCKED", locked_minor: 500, updated_at: "2026-10-04T00:00:00Z", funded_at: null, funded_minor: null, wallet_refunded_at: null, assignments: [] },
    ], error: null };
    if (c.table === "payouts") return { data: [{ id: "o1", status: "cancelled", destination: "me@upi", amount_minor: 200, created_at: "2026-10-02T00:00:00Z" }], error: null };
    return { data: [{ id: "c1", purpose: "topup", amount_minor: 5000, paid_at: "2026-09-30T00:00:00Z", created_at: "x" }], error: null };
  });
  const r = await runOp("listWalletActivity", { limit: 10 }, ctx(f));
  assert.ok(r.ok);
  const ev = r.data as { id: string; amountMinor: number; incoming: boolean; title: string }[];
  assert.deepEqual(ev.map((e) => e.id), ["p-t1", "o-o1", "w-a1", "c-c1"]); // unpaid t2 left out
  assert.equal(ev[2].amountMinor, packageRules.workerNetPayout(Math.round(10300 / 1.03)));
  assert.equal(ev[1].title, "Withdrawal cancelled");
  assert.equal(ev[1].incoming, true);
});

await t("escrow held counts only paid-for jobs, for the side asked", async () => {
  const data = [
    { escrow_minor: 100, worker_id: UID, tasks: { poster_id: OTHER, funded_at: "x" } },
    { escrow_minor: 40, worker_id: OTHER, tasks: { poster_id: UID, funded_at: "x" } },
    { escrow_minor: 7, worker_id: UID, tasks: { poster_id: OTHER, funded_at: null } },
  ];
  const run = async (side: string | null) => {
    const r = await runOp("getEscrowHeld", { side }, ctx(fake(() => ({ data, error: null }))));
    return r.ok ? r.data : null;
  };
  assert.equal(await run(null), 140);
  assert.equal(await run("worker"), 100);
  assert.equal(await run("poster"), 40);
});

await t("canQuoteOn explains each refusal", async () => {
  const run = async (task: unknown, bid: unknown = null) => {
    const f = fake((c) => (c.table === "tasks" ? { data: task, error: null } : { data: bid, error: null }));
    const r = await runOp("canQuoteOn", { taskId: TASK }, ctx(f));
    return r.ok ? (r.data as { allowed: boolean; code?: string }) : null;
  };
  assert.equal((await run({ poster_id: UID, status: "OPEN", kind: "request" }))?.code, "own");
  assert.equal((await run({ poster_id: OTHER, status: "OPEN", kind: "service" }))?.code, "closed");
  assert.equal((await run({ poster_id: OTHER, status: "LOCKED", kind: "request" }))?.code, "closed");
  assert.equal((await run({ poster_id: OTHER, status: "OPEN", kind: "request" }, { id: BID }))?.code, "duplicate");
  assert.equal((await run({ poster_id: OTHER, status: "OPEN", kind: "request" }))?.allowed, true);
});

await t("counts come back as plain objects, and notification sides are worked out server-side", async () => {
  let r = await runOp("countBidsByTask", { taskIds: [TASK, TASK2] }, ctx(fake(() => ({ data: [{ task_id: TASK }, { task_id: TASK }, { task_id: TASK2 }], error: null }))));
  assert.ok(r.ok);
  assert.deepEqual(r.data, { [TASK]: 2, [TASK2]: 1 });
  const N1 = "55555555-5555-4555-8555-555555555555", N2 = "66666666-6666-4666-8666-666666666666", N3 = "77777777-7777-4777-8777-777777777777";
  r = await runOp("notificationSides", { rows: [{ id: N1, task_id: TASK }, { id: N2, task_id: TASK2 }, { id: N3, task_id: null }] },
    ctx(fake(() => ({ data: [{ id: TASK, poster_id: UID }, { id: TASK2, poster_id: OTHER }], error: null }))));
  assert.ok(r.ok);
  assert.deepEqual(r.data, { [N1]: "poster", [N2]: "worker", [N3]: "both" });
});

await t("tasks near a point are filtered and ordered by distance on the server", async () => {
  const here = { lat: 17.44, lng: 78.35 };
  const f = fake(() => ({ data: [
    { id: "far", poster_id: OTHER, status: "OPEN", loc_lat: 19.07, loc_lng: 72.87 },
    { id: "near", poster_id: OTHER, status: "OPEN", loc_lat: 17.45, loc_lng: 78.36 },
    { id: "mid", poster_id: OTHER, status: "OPEN", loc_lat: 17.39, loc_lng: 78.49 },
  ], error: null }));
  const r = await runOp("tasksNear", { ...here, radiusKm: 50, limit: 5 }, ctx(f));
  assert.ok(r.ok);
  assert.deepEqual((r.data as { id: string }[]).map((x) => x.id), ["near", "mid"]);
});

await t("helpers near a point come back nearest first, inside the radius, with only map-card fields", async () => {
  const here = { lat: 17.44, lng: 78.35 };
  const f = fake(() => ({ data: [
    { id: "far", skills: ["Cleaning"], loc_lat: 19.07, loc_lng: 72.87 },
    { id: "mid", skills: ["Plumbing"], loc_lat: 17.39, loc_lng: 78.49 },
    { id: "near", skills: ["Delivery"], loc_lat: 17.45, loc_lng: 78.36 },
  ], error: null }));
  const r = await runOp("workersNear", { ...here, radiusKm: 50, limit: 5 }, ctx(f));
  assert.ok(r.ok);
  assert.deepEqual((r.data as { id: string }[]).map((x) => x.id), ["near", "mid"]);
  const bad = await runOp("workersNear", { lat: 200, lng: 78, radiusKm: 5 }, ctx(f));
  assert.ok(!bad.ok && bad.error.code === "BAD_ARGS");
});

await t("helpers near a point carry their newest open service, and sellers without skills count too", async () => {
  const here = { lat: 17.44, lng: 78.35 };
  const f = fake((c) => {
    if (c.table === "tasks") {
      return { data: [
        { id: "s-new", poster_id: "near", title: "AC service", benchmark_minor: 39900, category: "Repairs" },
        { id: "s-old", poster_id: "near", title: "Fridge fix", benchmark_minor: 54900, category: "Repairs" },
        { id: "s-seller", poster_id: "seller", title: "Logo design", benchmark_minor: 99900, category: "Design" },
      ], error: null };
    }
    const asked = c.steps.find(([name]) => name === "in");
    if (asked) return { data: [{ id: "seller", skills: [], loc_lat: 17.43, loc_lng: 78.37 }], error: null };
    return { data: [{ id: "near", skills: ["AC repair"], loc_lat: 17.45, loc_lng: 78.36 }, { id: "plain", skills: ["Plumbing"], loc_lat: 17.46, loc_lng: 78.35 }], error: null };
  });
  const r = await runOp("workersNear", { ...here, radiusKm: 50, limit: 5 }, ctx(f));
  assert.ok(r.ok);
  const list = r.data as { id: string; top_service: { id: string; price_minor: number } | null; service_count: number }[];
  const byId = Object.fromEntries(list.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(byId).sort(), ["near", "plain", "seller"]);
  assert.equal(byId.near!.top_service?.id, "s-new");
  assert.equal(byId.near!.service_count, 2);
  assert.equal(byId.seller!.top_service?.price_minor, 99900);
  assert.equal(byId.plain!.top_service, null);
  assert.equal(byId.plain!.service_count, 0);
  // Only open, unexpired services, never the caller's own.
  const tasks = f.calls.find((c) => c.table === "tasks")!;
  assert.ok(tasks.steps.some(([n, args]) => n === "eq" && args[0] === "status" && args[1] === "OPEN"));
  assert.ok(tasks.steps.some(([n, args]) => n === "neq" && args[0] === "poster_id"));
});

await t("a helper's services are their open listings, asked by id", async () => {
  const f = fake(() => ({ data: [{ id: "s1", poster_id: OTHER, kind: "service" }], error: null }));
  const r = await runOp("workerServices", { userId: OTHER }, ctx(f));
  assert.ok(r.ok);
  const q = f.calls[0]!;
  assert.ok(q.steps.some(([n, args]) => n === "eq" && args[0] === "poster_id" && args[1] === OTHER));
  assert.ok(q.steps.some(([n, args]) => n === "eq" && args[0] === "kind" && args[1] === "service"));
  const bad = await runOp("workerServices", { userId: "nope" }, ctx(f));
  assert.ok(!bad.ok && bad.error.code === "BAD_ARGS");
});

// ------------------------------------------------------------------- media --

await t("uploads go to a server-chosen path in the caller's own folder", async () => {
  const f = fake();
  const r = await runOp("createUpload", { purpose: "proof", ext: "PDF" }, ctx(f));
  assert.ok(r.ok);
  const out = r.data as { path: string; url: string };
  assert.match(out.path, new RegExp(`^${UID}/proof-\\d+-[a-z0-9]{10}\\.pdf$`));
  assert.equal(f.storageCalls[0].bucket, "task-media");
  const badExt = await runOp("createUpload", { purpose: "task", ext: "../x" }, ctx(f));
  assert.ok(!badExt.ok && badExt.error.code === "BAD_ARGS");
});

await t("a file can only be removed from the caller's own folder", async () => {
  const f = fake();
  assert.ok((await runOp("removeMedia", { path: `${UID}/a.jpg` }, ctx(f))).ok);
  for (const path of [`${OTHER}/a.jpg`, `${UID}/../${OTHER}/a.jpg`]) {
    const r = await runOp("removeMedia", { path }, ctx(f));
    assert.ok(!r.ok && r.error.code === "BAD_ARGS", path);
  }
  assert.equal(f.storageCalls.length, 1);
});

await t("signing many files is one call, answered as { path: url }", async () => {
  const f = fake();
  const r = await runOp("signMedia", { paths: ["a/1.jpg", "a/2.jpg", "a/1.jpg"] }, ctx(f));
  assert.ok(r.ok);
  assert.deepEqual(r.data, { "a/1.jpg": "https://x/sign/a/1.jpg", "a/2.jpg": "https://x/sign/a/2.jpg" });
  assert.equal(f.storageCalls.length, 1);
});

// Made-up keys for the test only; they open nothing.
const IK: ImageKitConfig = { publicKey: "public_testkey", privateKey: "private_testkey", urlEndpoint: "https://ik.imagekit.io/demo", env: "local" };
const MEDIA_ID = "55555555-5555-4555-8555-555555555555";
const MEDIA_PATH = `/local/u/${UID}/${MEDIA_ID}.jpg`;

await t("a picture upload gets a signed ImageKit token, a server-chosen path and a pending registry row", async () => {
  const f = fake();
  const r = await runOp("createUpload", { purpose: "task", kind: "image", mime: "image/jpeg", ext: "jpg" }, ctx(f, { imagekit: IK }));
  assert.ok(r.ok);
  const out = r.data as { provider: string; id: string; ref: string; upload: Record<string, unknown> };
  assert.equal(out.provider, "imagekit");
  assert.equal(out.ref, `media:${out.id}`);
  const u = out.upload;
  assert.equal(u.folder, `/local/u/${UID}`);
  assert.equal(u.fileName, `${out.id}.jpg`);
  assert.equal(u.publicKey, "public_testkey");
  assert.equal(u.signature, createHmac("sha1", IK.privateKey).update(`${u.token}${u.expire}`).digest("hex"));
  assert.ok(JSON.stringify(out).indexOf(IK.privateKey) < 0, "the private key must never be sent to the app");
  assert.equal(f.storageCalls.length, 0, "nothing goes to Supabase Storage");
  const begin = f.calls.find((c) => c.rpc === "media_begin")!;
  assert.deepEqual(begin.args, {
    p_id: out.id, p_provider: "imagekit", p_purpose: "task", p_kind: "image", p_mime: "image/jpeg", p_path: `/local/u/${UID}/${out.id}.jpg`,
  });
  for (const bad of [{ mime: "image/svg+xml" }, { mime: "application/pdf" }, {}]) {
    const x = await runOp("createUpload", { purpose: "task", kind: "image", ...bad }, ctx(fake(), { imagekit: IK }));
    assert.ok(!x.ok && x.error.code === "BAD_ARGS", JSON.stringify(bad));
  }
});

await t("without ImageKit's keys, or for videos and documents, uploads go to Supabase as before and are recorded", async () => {
  const noKeys = fake();
  const a = await runOp("createUpload", { purpose: "task", kind: "image", mime: "image/jpeg", ext: "jpg" }, ctx(noKeys));
  assert.ok(a.ok && typeof (a.data as { url?: string }).url === "string");
  assert.equal(noKeys.storageCalls.length, 1);
  const video = fake();
  const b = await runOp("createUpload", { purpose: "task", kind: "video", ext: "mp4" }, ctx(video, { imagekit: IK }));
  assert.ok(b.ok && (b.data as { path: string }).path.startsWith(`${UID}/`));
  const rec = video.calls.find((c) => c.rpc === "media_begin")!.args as Record<string, unknown>;
  assert.equal(rec.p_provider, "supabase");
  assert.equal(rec.p_kind, "video");
  // An old app sends no kind; it is worked out from the extension.
  const old = fake();
  await runOp("createUpload", { purpose: "proof", ext: "pdf" }, ctx(old));
  assert.equal((old.calls.find((c) => c.rpc === "media_begin")!.args as Record<string, unknown>).p_kind, "file");
  // A failed record must not fail the upload.
  const broken = fake((c) => (c.rpc === "media_begin" ? { data: null, error: { message: "no such function" } } : { data: [], error: null }));
  assert.ok((await runOp("createUpload", { purpose: "task", ext: "jpg" }, ctx(broken))).ok);
});

const pendingRow = { id: MEDIA_ID, path: MEDIA_PATH, provider: "imagekit", status: "pending", provider_file_id: null };
const goodFile = { fileId: "f1", filePath: MEDIA_PATH, fileType: "image", size: 2_000_000, isPrivateFile: true };

function ikFetch(details: Record<string, unknown> | null) {
  const calls: { url: string; method: string }[] = [];
  const fetcher = async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (method === "DELETE") return { ok: true, status: 204, json: async () => null };
    return details
      ? { ok: true, status: 200, json: async () => details }
      : { ok: false, status: 404, json: async () => null };
  };
  return { fetcher, calls };
}
const attachDb = (row: Record<string, unknown> | null) =>
  fake((c) => {
    if (c.table === "media") return { data: row ? [row] : [], error: null };
    if (c.rpc === "media_attach") return { data: `media:${MEDIA_ID}`, error: null };
    return { data: null, error: null };
  });

await t("attaching checks with ImageKit that the file is the one we named, private, a picture and not too big", async () => {
  const ik = ikFetch(goodFile);
  const f = attachDb(pendingRow);
  const r = await runOp("attachMedia", { id: MEDIA_ID, fileId: "f1" }, ctx(f, { imagekit: IK, fetcher: ik.fetcher }));
  assert.ok(r.ok);
  assert.deepEqual(r.data, { ref: `media:${MEDIA_ID}`, bytes: 2_000_000 });
  assert.deepEqual(f.calls.find((c) => c.rpc === "media_attach")!.args, { p_id: MEDIA_ID, p_provider_file_id: "f1", p_bytes: 2_000_000 });
  assert.equal(ik.calls[0].url, "https://api.imagekit.io/v1/files/f1/details");
  const row = f.calls.find((c) => c.table === "media")!;
  assert.deepEqual(steps(row, "eq"), [["id", MEDIA_ID], ["owner", UID]], "only the caller's own upload");
});

await t("a fileId that points somewhere else is refused and nothing is deleted", async () => {
  const ik = ikFetch({ ...goodFile, filePath: `/local/u/${OTHER}/theirs.jpg` });
  const f = attachDb(pendingRow);
  const r = await runOp("attachMedia", { id: MEDIA_ID, fileId: "f1" }, ctx(f, { imagekit: IK, fetcher: ik.fetcher }));
  assert.ok(!r.ok && r.error.code === "UPLOAD");
  assert.ok(!ik.calls.some((c) => c.method === "DELETE"), "somebody else's file is never touched");
  assert.ok(!f.calls.some((c) => c.rpc === "media_attach"));
});

await t("our own file that is not acceptable (not a picture, public, or too big) is removed and refused", async () => {
  for (const bad of [{ fileType: "non-image" }, { isPrivateFile: false }, { size: 16 * 1024 * 1024 }, { size: 0 }]) {
    const ik = ikFetch({ ...goodFile, ...bad });
    const f = attachDb(pendingRow);
    const r = await runOp("attachMedia", { id: MEDIA_ID, fileId: "f1" }, ctx(f, { imagekit: IK, fetcher: ik.fetcher }));
    assert.ok(!r.ok && r.error.code === "UPLOAD", JSON.stringify(bad));
    assert.ok(ik.calls.some((c) => c.method === "DELETE" && c.url.endsWith("/files/f1")), JSON.stringify(bad));
    assert.ok(f.calls.some((c) => c.rpc === "media_discard"));
    assert.ok(!f.calls.some((c) => c.rpc === "media_attach"));
  }
});

await t("attaching twice is harmless; an unknown, someone else's or finished upload is refused", async () => {
  const done = attachDb({ ...pendingRow, status: "attached", provider_file_id: "f1" });
  const ik = ikFetch(goodFile);
  const again = await runOp("attachMedia", { id: MEDIA_ID, fileId: "f1" }, ctx(done, { imagekit: IK, fetcher: ik.fetcher }));
  assert.deepEqual(again.ok && again.data, { ref: `media:${MEDIA_ID}` });
  assert.equal(ik.calls.length, 0, "nothing to ask ImageKit the second time");
  const other = await runOp("attachMedia", { id: MEDIA_ID, fileId: "f2" }, ctx(done, { imagekit: IK, fetcher: ik.fetcher }));
  assert.ok(!other.ok && other.error.code === "UPLOAD");
  const none = await runOp("attachMedia", { id: MEDIA_ID, fileId: "f1" }, ctx(attachDb(null), { imagekit: IK, fetcher: ik.fetcher }));
  assert.ok(!none.ok && none.error.code === "BAD_ARGS");
  const off = await runOp("attachMedia", { id: MEDIA_ID, fileId: "f1" }, ctx(attachDb(pendingRow)));
  assert.ok(!off.ok && off.error.code === "UPLOAD");
  const junk = await runOp("attachMedia", { id: MEDIA_ID, fileId: "../etc" }, ctx(attachDb(pendingRow), { imagekit: IK, fetcher: ik.fetcher }));
  assert.ok(!junk.ok && junk.error.code === "BAD_ARGS");
  const gone = await runOp("attachMedia", { id: MEDIA_ID, fileId: "f1" }, ctx(attachDb(pendingRow), { imagekit: IK, fetcher: ikFetch(null).fetcher }));
  assert.ok(!gone.ok && gone.error.code === "UPLOAD");
});

await t("signing a media ref returns a signed ImageKit URL at the size asked for; storage paths still work; unreadable refs are left out", async () => {
  const mine = `media:${MEDIA_ID}`;
  const theirs = "media:66666666-6666-4666-8666-666666666666";
  const f = fake((c) => (c.rpc === "media_resolve"
    ? { data: [{ ref: mine, provider: "imagekit", provider_file_id: "f1", path: MEDIA_PATH, kind: "image" }], error: null }
    : { data: null, error: null }));
  const r = await runOp("signMedia", { paths: [mine, theirs, "a/1.jpg"], size: "thumb" }, ctx(f, { imagekit: IK }));
  assert.ok(r.ok);
  const out = r.data as Record<string, string>;
  assert.deepEqual(Object.keys(out).sort(), [mine, "a/1.jpg"].sort());
  const expiry = Number(new URL(out[mine]).searchParams.get("ik-t"));
  const rest = `tr:w-200,h-200,c-at_max,q-80,f-auto${MEDIA_PATH}`;
  assert.equal(out[mine], `https://ik.imagekit.io/demo/${rest}?ik-t=${expiry}&ik-s=${createHmac("sha1", IK.privateKey).update(`${rest}${expiry}`).digest("hex")}`);
  assert.deepEqual(f.calls.find((c) => c.rpc === "media_resolve")!.args, { p_refs: [mine, theirs] });
  assert.equal(f.storageCalls.length, 1, "only the plain path goes to Supabase Storage");
  // An old app sends no size and still gets a picture it can show.
  const old = await runOp("signMedia", { paths: [mine] }, ctx(f, { imagekit: IK }));
  assert.match((old.ok && (old.data as Record<string, string>)[mine]) || "", /tr:w-1600,h-1600/);
  const badSize = await runOp("signMedia", { paths: [mine], size: "huge" }, ctx(f, { imagekit: IK }));
  assert.ok(!badSize.ok && badSize.error.code === "BAD_ARGS");
  // No ImageKit keys: refs cannot be shown, and nothing is asked of the database.
  const none = fake();
  const noKeys = await runOp("signMedia", { paths: [mine] }, ctx(none));
  assert.deepEqual(noKeys.ok && noKeys.data, {});
  assert.ok(!none.calls.some((c) => c.rpc === "media_resolve"));
});

await t("a media ref can only be saved on a record when it is the caller's own finished upload for that purpose", async () => {
  const task = { pillar: "x", title: "Fix a tap", benchmarkMinor: 5000, timeLimitMinutes: 60 };
  const ref = `media:${MEDIA_ID}`;
  const owned = fake((c) => (c.table === "media" ? { data: [{ id: MEDIA_ID }], error: null } : { data: [{ id: "t1" }], error: null }));
  assert.ok((await runOp("createTask", { ...task, media: { kind: "image", path: ref } }, ctx(owned))).ok);
  const q = owned.calls.find((c) => c.table === "media")!;
  assert.deepEqual(steps(q, "eq"), [["id", MEDIA_ID], ["owner", UID], ["status", "attached"], ["kind", "image"]]);
  assert.deepEqual(steps(q, "in"), [["purpose", ["task"]]]);
  const notMine = fake((c) => (c.table === "media" ? { data: [], error: null } : { data: [{ id: "t1" }], error: null }));
  const refused = await runOp("createTask", { ...task, media: { kind: "image", path: ref } }, ctx(notMine));
  assert.ok(!refused.ok && refused.error.code === "BAD_ARGS");
  assert.ok(!notMine.calls.some((c) => c.table === "tasks"), "the task is not saved");
  const junk = await runOp("createTask", { ...task, media: { kind: "image", path: "media:not-a-uuid" } }, ctx(owned));
  assert.ok(!junk.ok && junk.error.code === "BAD_ARGS");

  const avatar = fake((c) => (c.table === "media" ? { data: [], error: null } : { data: [{ id: UID }], error: null }));
  const a = await runOp("updateProfile", { avatarUrl: ref }, ctx(avatar));
  assert.ok(!a.ok && a.error.code === "BAD_ARGS");
  assert.ok(!avatar.calls.some((c) => c.table === "profiles"));

  const proof = fake((c) => (c.table === "media" ? { data: [], error: null } : { data: [{ id: "p1" }], error: null }));
  const p = await runOp("submitProof", { taskId: TASK, summary: "done", files: [{ path: ref, kind: "image", name: "Photo" }] }, ctx(proof));
  assert.ok(!p.ok && p.error.code === "BAD_ARGS");

  const chat = fake((c) => (c.table === "media" ? { data: [], error: null } : { data: { id: "m1" }, error: null }));
  const m = await runOp("sendMessage", { taskId: TASK, body: `::media::${ref}` }, ctx(chat));
  assert.ok(!m.ok && m.error.code === "BAD_ARGS");
  assert.ok(!chat.calls.some((c) => c.table === "messages"));
  // An ordinary message, and an old storage path, are untouched by all this.
  const plain = fake();
  assert.ok((await runOp("sendMessage", { taskId: TASK, body: "hello" }, ctx(plain))).ok);
  assert.ok(!plain.calls.some((c) => c.table === "media"));
});

await t("removing a media ref asks the database to discard it; only the owner's unused pictures go", async () => {
  const f = fake();
  assert.ok((await runOp("removeMedia", { path: `media:${MEDIA_ID}` }, ctx(f))).ok);
  assert.deepEqual(f.calls.find((c) => c.rpc === "media_discard")!.args, { p_ref: `media:${MEDIA_ID}` });
  assert.equal(f.storageCalls.length, 0);
});

await t("attaching a picture counts against the upload limit", () => {
  assert.equal(rateBucket("attachMedia"), "upload");
});

await t("a withdrawal is handed to the payout function after the debit", async () => {
  const handed: unknown[] = [];
  const f = fake((c) => (c.rpc === "request_withdrawal" ? { data: { id: "p1" }, error: null } : { data: null, error: null }));
  const r = await runOp("requestWithdrawal", { amountMinor: 500, destinationId: null }, ctx(f, { callFunction: async (n: string, b: unknown) => { handed.push([n, b]); } }));
  assert.ok(r.ok);
  assert.deepEqual(handed, [["razorpayx-payouts", { action: "send", payoutId: "p1" }]]);
});

await t("deleting an account passes the confirmation through and removes the files the database lists", async () => {
  const removed: string[][] = [];
  const f = fake((c) =>
    c.rpc === "delete_my_account" ? { data: { files: [`${UID}/a.jpg`, 7, `${UID}/b.jpg`] }, error: null } : { data: null, error: null });
  const r = await runOp("deleteMyAccount", { confirm: "DELETE MY ACCOUNT" }, ctx(f, { removeOwnFiles: async (p: string[]) => { removed.push(p); } }));
  assert.ok(r.ok);
  assert.deepEqual(f.calls[0].args, { p_confirm: "DELETE MY ACCOUNT" });
  assert.deepEqual(removed, [[`${UID}/a.jpg`, `${UID}/b.jpg`]]);
  assert.equal(rateBucket("deleteMyAccount"), "write");
});

await t("a refused account deletion says why and removes nothing", async () => {
  let removed = false;
  const f = fake(() => ({ data: null, error: { message: "You have ₹250.00 in your wallet. Withdraw it first.", code: "P0001" } }));
  const r = await runOp("deleteMyAccount", { confirm: "DELETE MY ACCOUNT" }, ctx(f, { removeOwnFiles: async () => { removed = true; } }));
  assert.ok(!r.ok);
  assert.match(r.error.message, /Withdraw it first/);
  assert.equal(removed, false);
  const missing = await runOp("deleteMyAccount", {}, ctx(fake()));
  assert.ok(!missing.ok && missing.error.code === "BAD_ARGS");
});

await t("money and other writes get the tight rate limit, uploads the tightest", () => {
  for (const op of ["lockBid", "requestWithdrawal", "placeBid", "sendMessage", "removeMedia"]) assert.equal(rateBucket(op), "write", op);
  for (const op of ["listOpenTasks", "getWallet", "signMedia", "nope", undefined]) assert.equal(rateBucket(op), "read", String(op));
  assert.equal(rateBucket("createUpload"), "upload");
  assert.ok(RATE_LIMITS.upload < RATE_LIMITS.write && RATE_LIMITS.write < RATE_LIMITS.read);
});

await t("a person the limiter refused is remembered for a minute, then forgotten", () => {
  let clock = 1_000;
  const seen = new RecentlyLimited(60_000, () => clock);
  assert.equal(seen.has(UID), false);
  seen.mark(UID);
  assert.equal(seen.has(UID), true);
  assert.equal(seen.has(OTHER), false, "only that person");
  clock += 59_999;
  assert.equal(seen.has(UID), true);
  clock += 1;
  assert.equal(seen.has(UID), false, "expired");
});

await t("the refused-people list cannot grow without bound", () => {
  let clock = 0;
  const seen = new RecentlyLimited(60_000, () => clock);
  for (let i = 0; i < 499; i++) seen.mark(`u${i}`);
  clock += 60_000;
  seen.mark("fresh");
  assert.equal(seen.has("u0"), false, "stale entries are dropped first");
  assert.equal(seen.has("fresh"), true);
  for (let i = 0; i < 600; i++) seen.mark(`v${i}`);
  assert.equal(seen.has("v599"), true, "the newest is kept");
});

// ------------------------------------------------------- app controls --

/** Controls as get_app_controls would hand them back, with a few things changed. */
const controlsWith = (patch: Record<string, unknown> = {}): Controls => parseControls({ platform: "android", ...patch })!;
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

await t("the platform and app version come from the request headers; anything else is the old app", () => {
  assert.deepEqual(readClient(headers({ "x-taskdrop-platform": "Android", "x-taskdrop-app-version": "1.2.0" })), { platform: "android", appVersion: "1.2.0" });
  assert.deepEqual(readClient(headers({})), { platform: null, appVersion: null });
  assert.deepEqual(readClient(headers({ "x-taskdrop-platform": "toaster", "x-taskdrop-app-version": "v1; drop table" })), { platform: null, appVersion: null });
});

await t("with everything on, nothing is refused", async () => {
  const f = fake();
  for (const op of ["createTask", "placeBid", "requestWithdrawal", "startPromotion", "sendMessage", "listOpenTasks"]) {
    assert.equal(refusalFor(op, controlsWith()), null, op);
  }
  assert.equal(refusalFor("createTask", null), null, "unreadable switches never refuse");
  const r = await runOp("touchPresence", {}, ctx(f, { controls: controlsWith() }));
  assert.ok(r.ok);
});

await t("a switch that is off refuses its own operations with a typed error, and leaves the rest alone", async () => {
  const cases: [string, string, Record<string, unknown>][] = [
    ["posting", "createTask", { pillar: "x", title: "t", benchmarkMinor: 1, timeLimitMinutes: 1 }],
    ["bidding", "placeBid", { taskId: TASK, priceMinor: 1, timeLimitMinutes: 1 }],
    ["bidding", "updateBid", { bidId: BID, priceMinor: 1, timeLimitMinutes: 1 }],
    ["withdrawals", "requestWithdrawal", { amountMinor: 500 }],
    ["promotions", "startPromotion", { taskId: TASK, days: 3, amountMinor: 500 }],
    ["chat_photos", "sendMessage", { taskId: TASK, body: "::media::" + UID + "/a.jpg" }],
    ["chat_photos", "createUpload", { purpose: "chat", ext: "jpg" }],
  ];
  for (const [feature, op, args] of cases) {
    const f = fake();
    const r = await runOp(op, args, ctx(f, { controls: controlsWith({ [feature]: false }) }));
    assert.ok(!r.ok, op);
    if (!r.ok) {
      assert.equal(r.error.code, "FEATURE_OFF", op);
      assert.equal(r.error.details, feature, op);
      assert.equal(r.error.message, featureOffMessage(feature as never), op);
    }
    assert.equal(f.calls.length, 0, `${op} reached the database although its switch is off`);
  }
  // other operations, and a plain text chat message, still work
  const f = fake();
  const text = await runOp("sendMessage", { taskId: TASK, body: "hello" }, ctx(f, { controls: controlsWith({ chat_photos: false }) }));
  assert.ok(text.ok);
  const bid = await runOp("placeBid", { taskId: TASK, priceMinor: 2000, timeLimitMinutes: 1 }, ctx(fake(), { controls: controlsWith({ posting: false, withdrawals: false }) }));
  assert.ok(bid.ok);
  const up = await runOp("createUpload", { purpose: "task", ext: "jpg" }, ctx(fake(), { controls: controlsWith({ chat_photos: false }) }));
  assert.ok(up.ok);
});

await t("money already in motion is never blocked by a switch", () => {
  const off = controlsWith({ promotions: false, topups: false, withdrawals: false, posting: false, bidding: false });
  for (const op of ["activatePromotion", "cancelPromotion", "lockBid", "payTaskFromWallet", "cancelWithdrawal", "cancelTask", "confirmRelease", "getWallet"]) {
    assert.equal(refusalFor(op, off), null, op);
  }
});

await t("maintenance refuses everything but bookkeeping, with the admin's words", async () => {
  const c = controlsWith({ maintenance: true, maintenance_message: "Back at 6pm" });
  for (const op of ["listOpenTasks", "getWallet", "createTask", "sendMessage", "signMedia"]) {
    const r = await runOp(op, {}, ctx(fake(), { controls: c }));
    assert.ok(!r.ok, op);
    if (!r.ok) assert.deepEqual([r.error.code, r.error.message], ["MAINTENANCE", "Back at 6pm"], op);
  }
  for (const op of ["touchPresence", "recordDevice"]) assert.equal(refusalFor(op, c), null, op);
  const plain = refusalFor("getWallet", controlsWith({ maintenance: true }));
  assert.match(plain!.message, /being updated/);
});

await t("below the minimum version, everything but bookkeeping asks for an update", async () => {
  const c = controlsWith({ update_required: true, min_version: "2.0.0" });
  const r = await runOp("listOpenTasks", {}, ctx(fake(), { controls: c }));
  assert.ok(!r.ok);
  if (!r.ok) assert.deepEqual([r.error.code, r.error.details], ["UPDATE_REQUIRED", "2.0.0"]);
  assert.equal(refusalFor("recordDevice", c), null);
});

await t("the public config has the shape the app and the admin preview read", () => {
  const c = controlsWith({ bidding: false, banner_text: "Hello", banner_level: "warning", min_version: "1.5.0", update_required: true, update_url: "https://example.com/get" });
  const cfg = publicConfig(c, { platform: "android", appVersion: "1.0.0" });
  assert.deepEqual(cfg.update, { required: true, minVersion: "1.5.0", url: "https://example.com/get" });
  assert.equal(cfg.features.bidding, false);
  assert.equal(cfg.features.posting, true);
  assert.deepEqual(cfg.banner, { text: "Hello", level: "warning", link: null });
  assert.deepEqual(cfg.maintenance, { on: false, message: null });
  assert.equal(cfg.ttlSeconds, 60);
  assert.equal(OPEN_CONFIG.banner, null);
  assert.ok(Object.values(OPEN_CONFIG.features).every(Boolean) && !OPEN_CONFIG.maintenance.on && !OPEN_CONFIG.update.required);
  assert.equal(parseControls("nope"), null);
});

await t("the public config carries the environment, and staging whenever it is missing or unreadable", () => {
  const client = { platform: "web", appVersion: null } as const;
  assert.equal(publicConfig(controlsWith({ environment: "production" }), client).environment, "production");
  assert.equal(publicConfig(controlsWith({ environment: "staging" }), client).environment, "staging");
  for (const v of [undefined, null, "", "Production", "prod", 1, true]) {
    assert.equal(parseControls({ environment: v })!.environment, "staging", String(v));
  }
  assert.equal(parseControls({})!.environment, "staging");
  assert.equal(OPEN_CONFIG.environment, "staging");
  // the answer the app reads keeps every field it had before
  const cfg = publicConfig(controlsWith(), client);
  assert.deepEqual(Object.keys(cfg).sort(), ["appVersion", "banner", "environment", "features", "maintenance", "platform", "requirePhoneVerified", "ttlSeconds", "update"]);
});

await t("controls are looked up once per half minute per kind of caller, and a failed refresh keeps the last answer", async () => {
  let clock = 1_000_000, loads = 0, fail = false;
  const cache = new ControlsCache(30_000, () => clock);
  const load = async () => {
    loads++;
    if (fail) throw new Error("db down");
    return controlsWith({ bidding: loads < 3 });
  };
  const android = { platform: "android", appVersion: "1.0.0" } as const;
  const first = await cache.get(android, load);
  await Promise.all([cache.get(android, load), cache.get(android, load)]);
  assert.equal(loads, 1);
  await cache.get({ platform: "ios", appVersion: "1.0.0" }, load);
  assert.equal(loads, 2);
  clock += 31_000;
  fail = true;
  const stale = await cache.get(android, load);
  assert.equal(stale, first, "a failed refresh falls back to the last good answer");
  assert.equal(await new ControlsCache(30_000).get(android, load), null, "no answer at all is null, which never refuses");
});

await t("the caller comes from a checked token's claims; anything that did not check out is nobody", () => {
  const ok = (claims: Record<string, unknown>) => callerFromClaims({ data: { claims }, error: null });
  assert.equal(ok({ sub: UID, role: "authenticated" }), UID);
  assert.equal(callerFromClaims({ data: { claims: { sub: UID } }, error: new Error("Invalid JWT signature") }), null, "a failed check");
  assert.equal(callerFromClaims({ data: null, error: null }), null, "no answer");
  assert.equal(callerFromClaims(null), null);
  assert.equal(callerFromClaims(undefined), null);
  assert.equal(ok({ role: "anon" }), null, "the anon key has no subject");
  assert.equal(ok({ sub: "" }), null);
  assert.equal(ok({ sub: 42 }), null);
  assert.equal(ok({ sub: "not-a-uuid" }), null);
});

/** A service-role stand-in for the two lookups behind a person's standing. */
function standingDb(o: { suspended?: boolean; deletedAt?: string | null; noProfile?: boolean; fail?: boolean }) {
  const asked: string[] = [];
  const q = (table: string, result: () => { data: unknown; error: unknown }) => {
    const p: unknown = new Proxy(function () {}, {
      get(_t, name) {
        if (name === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
        if (name === "maybeSingle") return () => p;
        return (...args: unknown[]) => {
          asked.push(table + "." + String(name) + "(" + args.map(String).join(",") + ")");
          return p;
        };
      },
    });
    return p;
  };
  const err = () => (o.fail ? { message: "db down" } : null);
  return {
    asked,
    from: (table: string) =>
      table === "user_suspensions"
        ? q(table, () => ({ data: o.suspended ? [{ id: "s" }] : [], error: err() }))
        : q(table, () => ({ data: o.noProfile ? null : { deleted_at: o.deletedAt ?? null }, error: err() })),
  };
}

await t("a suspended or deleted person is refused even though their token still checks out; a normal one passes", async () => {
  assert.equal(await standingOf(standingDb({}), UID), "ok", "a normal person passes");
  const banned = standingDb({ suspended: true });
  assert.equal(await standingOf(banned, UID), "suspended", "a token-valid but suspended person is refused");
  assert.ok(banned.asked.includes("user_suspensions.is(lifted_at,null)"), "only an open suspension counts");
  assert.ok(banned.asked.includes(`user_suspensions.eq(user_id,${UID})`));
  assert.equal(await standingOf(standingDb({ deletedAt: "2026-10-27T00:00:00Z" }), UID), "deleted", "an account the person deleted");
  assert.equal(await standingOf(standingDb({ noProfile: true }), UID), "deleted", "an auth user that is gone altogether");
  assert.equal(await standingOf(standingDb({ suspended: true, deletedAt: "2026-10-27T00:00:00Z" }), UID), "deleted");
  assert.equal(await standingOf(standingDb({ fail: true }), UID), null, "unreadable is not a verdict");
});

await t("standing is remembered for a few seconds only, so a ban bites quickly; unreadable answers are not kept", async () => {
  let clock = 1_000_000, loads = 0, next: "ok" | "suspended" | null = "ok";
  const cache = new StandingCache(5_000, () => clock);
  const load = async () => (loads++, next);
  assert.equal(await cache.get(UID, load), "ok");
  await Promise.all([cache.get(UID, load), cache.get(UID, load)]);
  assert.equal(loads, 1, "a burst of calls asks once");
  next = "suspended";
  clock += 4_000;
  assert.equal(await cache.get(UID, load), "ok", "still the old answer inside the window");
  clock += 1_500;
  assert.equal(await cache.get(UID, load), "suspended", "a suspension is seen within 5 seconds");
  assert.equal(await cache.get(OTHER, async () => "ok"), "ok", "each person has their own entry");
  next = null;
  clock += 6_000;
  assert.equal(await cache.get(UID, load), null);
  next = "ok";
  assert.equal(await cache.get(UID, load), "ok", "an unreadable answer was not kept");
  assert.equal(await cache.get(UID, async () => { throw new Error("boom"); }), "ok", "inside the window the kept answer is used");
});

await t("api/index.ts refuses a suspended or deleted caller with the sign-in-again 401, before any operation runs", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes("standingCache.get(userId, () => standingOf(admin, userId))"));
  const refusal = src.indexOf('accountStanding === "suspended" || accountStanding === "deleted"');
  const run = src.indexOf("const running =");
  assert.ok(refusal > 0 && run > refusal, "the refusal comes before the operation starts");
  assert.match(src.slice(refusal, refusal + 400), /UNAUTHENTICATED", 401/);
});

/** A service-role stand-in for the one profile lookup behind the session cutoff. */
function cutoffDb(row: { sessions_revoked_at?: string | null; sessions_keep_session?: string | null } | null, fail = false) {
  const q: unknown = new Proxy(function () {}, {
    get(_t, name) {
      if (name === "then") return (res: (v: unknown) => unknown) => Promise.resolve({ data: row, error: fail ? { message: "db down" } : null }).then(res);
      return () => q;
    },
  });
  return { from: () => q };
}

await t("a token issued before the person's sessions were ended is refused; the kept session and newer tokens pass", async () => {
  const at = "2026-11-03T10:00:00.000Z";
  const sec = Date.parse(at) / 1000;
  const cut = await cutoffOf(cutoffDb({ sessions_revoked_at: at, sessions_keep_session: "keep-1" }), UID);
  assert.deepEqual(cut, { revokedAtSec: sec, keepSession: "keep-1" });
  assert.equal(endedBefore(cut, { iat: sec - 600, sessionId: "old" }), true, "an old token from another device is refused");
  assert.equal(endedBefore(cut, { iat: sec - 600, sessionId: "keep-1" }), false, "the device that changed the password stays in");
  assert.equal(endedBefore(cut, { iat: sec + 5, sessionId: "new" }), false, "signing in again after works");
  assert.equal(endedBefore(cut, { iat: null, sessionId: null }), true, "a token with no issue time cannot be shown to be newer");
  const all = await cutoffOf(cutoffDb({ sessions_revoked_at: at, sessions_keep_session: null }), UID);
  assert.equal(endedBefore(all, { iat: sec - 1, sessionId: "any" }), true, "sign out of all devices keeps none");
  assert.equal(endedBefore(await cutoffOf(cutoffDb({ sessions_revoked_at: null }), UID), { iat: 1, sessionId: "x" }), false, "nobody ended anything");
  assert.equal(endedBefore(null, { iat: 1, sessionId: "x" }), false, "unreadable lets the call through, like standing");
  assert.equal(await cutoffOf(cutoffDb(null, true), UID), null, "unreadable is not a verdict");
});

await t("the token's issue time and session are read from the signed claims, and only when the check succeeded", () => {
  assert.deepEqual(tokenFacts({ data: { claims: { iat: 1700000000, session_id: "s-1" } }, error: null }), { iat: 1700000000, sessionId: "s-1" });
  assert.deepEqual(tokenFacts({ data: { claims: { iat: "1700000000" } }, error: null }), { iat: null, sessionId: null }, "a string is not a time");
  assert.deepEqual(tokenFacts({ data: null, error: new Error("bad") }), { iat: null, sessionId: null });
  assert.deepEqual(tokenFacts(null), { iat: null, sessionId: null });
});

await t("api/index.ts refuses an ended session with the sign-in-again 401, before any operation runs", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes("cutoffCache.get(userId, () => cutoffOf(admin, userId))"));
  const refusal = src.indexOf("endedBefore(sessionCutoff, token)");
  const run = src.indexOf("const running =");
  assert.ok(refusal > 0 && run > refusal, "the refusal comes before the operation starts");
  assert.match(src.slice(refusal, refusal + 400), /UNAUTHENTICATED", 401/);
});

await t("endMySessions asks the database to end all sessions or all but this one, says how many, and counts as a write", async () => {
  const f = fake(() => ({ data: 3, error: null }));
  assert.deepEqual(await runOp("endMySessions", { all: true }, ctx(f)), { ok: true, data: { ended: 3 } });
  assert.deepEqual(f.calls.at(-1)?.args, { p_all: true });
  assert.equal(f.calls.at(-1)?.rpc, "end_my_sessions");
  await runOp("endMySessions", {}, ctx(f));
  assert.deepEqual(f.calls.at(-1)?.args, { p_all: false });
  const bad = await runOp("endMySessions", { all: "yes" }, ctx(f));
  assert.ok(!bad.ok && bad.error.code === "BAD_ARGS");
  assert.equal(rateBucket("endMySessions"), "write");
});

await t("api/index.ts checks the token with getClaims and asks the auth service only while the phone switch is on", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /const claimsResult = await db\.auth\.getClaims\(jwt\)\.catch\(\(\) => null\);\s*const userId = callerFromClaims\(claimsResult\)/);
  assert.equal((src.match(/auth\.getUser\(/g) ?? []).length, 1, "one getUser, and only for the phone check");
  assert.match(src, /if \(controls\?\.require_phone_verified\) \{\s*const \{ data: userData, error: userErr \} = await db\.auth\.getUser\(jwt\)/);
});

await t("a device is recorded from the headers, and registering a push token never fails because of it", async () => {
  const f = fake(() => ({ data: null, error: null }));
  const client = { platform: "android", appVersion: "1.4.0" } as const;
  const r = await runOp("recordDevice", { installId: "install-abcdef12", platform: "web", osVersion: "Android 15" }, ctx(f, { client }));
  assert.ok(r.ok);
  assert.deepEqual(f.calls[0].args, { p_install_id: "install-abcdef12", p_platform: "android", p_app_version: "1.4.0", p_os_version: "Android 15", p_push: false });

  // an old build with no headers says it itself; a bad id is refused
  const g = fake();
  assert.ok((await runOp("recordDevice", { installId: "install-abcdef12", platform: "ios", appVersion: "0.9.0" }, ctx(g))).ok);
  assert.equal((g.calls[0].args as Record<string, unknown>).p_platform, "ios");
  const bad1 = await runOp("recordDevice", { installId: "x", platform: "ios" }, ctx(fake()));
  assert.ok(!bad1.ok && bad1.error.code === "BAD_ARGS");
  assert.equal(rateBucket("recordDevice"), "write");

  // the push token alone when the app sends no install id (an older build)
  const token = "ExponentPushToken[abc]";
  const h = fake(() => ({ data: null, error: null }));
  assert.ok((await runOp("registerPushToken", { token, platform: "android" }, ctx(h))).ok);
  assert.deepEqual(h.calls.map((c) => c.rpc), ["register_push_token"]);
  // a newer build also records the device, as one with push
  const i = fake(() => ({ data: null, error: null }));
  assert.ok((await runOp("registerPushToken", { token, platform: "android", installId: "install-abcdef12" }, ctx(i, { client }))).ok);
  assert.deepEqual(i.calls.map((c) => c.rpc), ["register_push_token", "record_device"]);
  assert.equal((i.calls[1].args as Record<string, unknown>).p_push, true);
  // ... and if the device record fails, the registration still succeeds
  const j = fake((c) => (c.rpc === "record_device" ? { data: null, error: { message: "boom", code: "XX000" } } : { data: null, error: null }));
  assert.ok((await runOp("registerPushToken", { token, platform: "android", installId: "install-abcdef12" }, ctx(j, { client }))).ok);
});

await t("reports and blocks pass the right ids to their SQL functions and refuse bad input", async () => {
  const f = fake(() => ({ data: null, error: null }));
  assert.ok((await runOp("reportContent", { targetType: "task", targetId: TASK, reason: " scam " }, ctx(f))).ok);
  assert.deepEqual(f.calls[0].args, { p_type: "task", p_target: TASK, p_reason: "scam" });
  assert.ok((await runOp("reportContent", { targetType: "message", targetId: TASK, reason: "rude" }, ctx(f))).ok);
  assert.equal((f.calls[f.calls.length - 1].args as { p_type: string }).p_type, "message");
  assert.ok((await runOp("blockUser", { userId: OTHER }, ctx(f))).ok);
  assert.deepEqual(f.calls[f.calls.length - 1].args, { p_user: OTHER });
  assert.ok((await runOp("unblockUser", { userId: OTHER }, ctx(f))).ok);
  for (const bad of [{ targetType: "photo", targetId: TASK, reason: "x" }, { targetType: "user", targetId: "nope", reason: "x" }, { targetType: "user", targetId: OTHER, reason: "" }]) {
    const r = await runOp("reportContent", bad, ctx(fake()));
    assert.ok(!r.ok && r.error.code === "BAD_ARGS");
  }
  assert.equal(rateBucket("reportContent"), "write");
});

await t("the feedback board passes clean arguments to its SQL functions and refuses bad input", async () => {
  const f = fake(() => ({ data: [], error: null }));
  assert.ok((await runOp("listFeedbackBoard", {}, ctx(f))).ok);
  assert.deepEqual(f.calls[0].args, {
    p_sort: "top", p_status: null, p_category: null, p_search: null, p_limit: 30, p_offset: 0,
  });
  assert.ok((await runOp("listFeedbackBoard", { sort: "new", status: "planned", category: "bug", search: " dark ", limit: 500 }, ctx(f))).ok);
  assert.deepEqual(f.calls[1].args, {
    p_sort: "new", p_status: "planned", p_category: "bug", p_search: "dark", p_limit: 50, p_offset: 0,
  });
  assert.equal(f.calls[1].rpc, "feedback_board_list");
  assert.ok((await runOp("getFeedbackPost", { postId: TASK }, ctx(f))).ok);
  assert.deepEqual(f.calls[2].args, { p_post: TASK });

  assert.ok((await runOp("postFeedbackIdea", { title: " Dark mode ", body: "", category: "feature" }, ctx(f))).ok);
  assert.deepEqual(f.calls[3].args, { p_title: "Dark mode", p_body: "", p_category: "feature" });
  assert.ok((await runOp("voteFeedbackIdea", { postId: TASK, on: false }, ctx(f))).ok);
  assert.deepEqual(f.calls[4].args, { p_post: TASK, p_on: false });
  assert.ok((await runOp("commentFeedbackIdea", { postId: TASK, body: " yes " }, ctx(f))).ok);
  assert.deepEqual(f.calls[5].args, { p_post: TASK, p_body: "yes" });

  const cases: [string, Record<string, unknown>][] = [
    ["listFeedbackBoard", { sort: "sideways" }],
    ["listFeedbackBoard", { status: "maybe" }],
    ["listFeedbackBoard", { category: "gossip" }],
    ["listFeedbackBoard", { search: "x".repeat(61) }],
    ["getFeedbackPost", { postId: "nope" }],
    ["postFeedbackIdea", { title: "ab", body: "" }],
    ["postFeedbackIdea", { title: "x".repeat(121), body: "" }],
    ["postFeedbackIdea", { title: "A fine title", body: "x".repeat(2001) }],
    ["postFeedbackIdea", { title: "A fine title", body: "", category: "gossip" }],
    ["voteFeedbackIdea", { postId: "nope" }],
    ["commentFeedbackIdea", { postId: TASK, body: "" }],
    ["commentFeedbackIdea", { postId: TASK, body: "x".repeat(1001) }],
  ];
  for (const [op, args] of cases) {
    const r = await runOp(op, args, ctx(fake()));
    assert.ok(!r.ok && r.error.code === "BAD_ARGS", `${op} ${JSON.stringify(args).slice(0, 40)}`);
  }
  assert.equal(rateBucket("listFeedbackBoard"), "read");
  assert.equal(rateBucket("getFeedbackPost"), "read");
  for (const op of ["postFeedbackIdea", "voteFeedbackIdea", "commentFeedbackIdea"]) assert.equal(rateBucket(op), "write", op);
});

await t("the verified-phone switch refuses only a known unverified caller, and only for posting, offers and withdrawals", async () => {
  const on = controlsWith({ require_phone_verified: true });
  for (const op of ["createTask", "placeBid", "updateBid", "requestWithdrawal"]) {
    const r = refusalFor(op, on, {}, { phoneVerified: false });
    assert.ok(r && r.code === "PHONE_REQUIRED", op);
    assert.equal(refusalFor(op, on, {}, { phoneVerified: true }), null, op + " verified");
    assert.equal(refusalFor(op, on, {}, {}), null, op + " unknown");
  }
  for (const op of ["listOpenTasks", "sendMessage", "registerPushToken", "startPromotion"]) {
    assert.equal(refusalFor(op, on, {}, { phoneVerified: false }), null, op + " is not gated");
  }
  assert.equal(refusalFor("createTask", controlsWith(), {}, { phoneVerified: false }), null, "switch off");
  const f = fake(() => ({ data: null, error: null }));
  const res = await runOp("createTask", {}, ctx(f, { controls: on, phoneVerified: false }));
  assert.ok(!res.ok && res.error.code === "PHONE_REQUIRED");
  assert.equal(f.calls.length, 0, "nothing reached the database");
});

await t("an auto-hire task cannot be posted unless the wallet covers the budget plus the fee", async () => {
  const task = { pillar: "services", title: "Fix tap", benchmarkMinor: 10000, timeLimitMinutes: 30, assignmentMode: "auto" };
  const withWallet = (balance: number) =>
    fake((c) =>
      c.table === "wallets" ? { data: { balance_minor: balance }, error: null }
        : c.table === "settings" ? { data: [], error: null }
        : { data: [{ id: "row" }], error: null });

  const short = withWallet(10000);
  const refused = await runOp("createTask", task, ctx(short));
  assert.ok(!refused.ok);
  if (!refused.ok) {
    assert.equal(refused.error.message, "Not enough money in your wallet");
    assert.equal(refused.error.details, "300", "short by the 3% fee on ₹100");
  }
  assert.ok(!short.calls.some((c) => c.table === "tasks"), "nothing was posted");

  const enough = withWallet(10300);
  assert.ok((await runOp("createTask", task, ctx(enough))).ok);
  assert.ok(enough.calls.some((c) => c.table === "tasks"));

  const bids = fake();
  assert.ok((await runOp("createTask", { ...task, assignmentMode: "bids" }, ctx(bids))).ok, "see-offers tasks need no balance");
  assert.ok(!bids.calls.some((c) => c.table === "wallets"));
});

// ------------------------------------------------------------------- batch --

await t("a batch runs several reads at once and answers each in order", async () => {
  const f = fake();
  const res = await runBatch({ calls: [{ op: "getWallet" }, { op: "listMyTasks", args: { kind: "request" } }, { op: "nope" }] }, ctx(f));
  assert.ok(res.ok);
  const replies = res.data as Array<{ ok: boolean; error?: { code: string } }>;
  assert.equal(replies.length, 3);
  assert.ok(replies[0].ok && replies[1].ok);
  assert.ok(!replies[2].ok && replies[2].error?.code === "UNKNOWN_OP", "an unknown name fails alone");
  assert.deepEqual(f.calls.map((c) => c.table).sort(), ["tasks", "wallets"]);
});

await t("a batch never carries a write, an upload or another batch", async () => {
  const f = fake();
  const res = await runBatch({ calls: [{ op: "lockBid", args: { bidId: BID } }, { op: "createUpload" }, { op: "removeMedia", args: { path: "x" } }, { op: "batch", args: { calls: [{ op: "getWallet" }] } }] }, ctx(f));
  assert.ok(res.ok);
  const codes = (res.data as Array<{ error?: { code: string } }>).map((r) => r.error?.code);
  assert.deepEqual(codes, ["NOT_BATCHABLE", "NOT_BATCHABLE", "NOT_BATCHABLE", "UNKNOWN_OP"]);
  assert.equal(f.calls.length, 0, "nothing reached the database");
});

await t("a batch with no usable list of calls is refused whole", async () => {
  const f = fake();
  for (const args of [undefined, {}, { calls: [] }, { calls: "x" }, { calls: [null] }, { calls: [{ op: 5 }] }, { calls: Array.from({ length: MAX_BATCH + 1 }, () => ({ op: "getWallet" })) }]) {
    const res = await runBatch(args, ctx(f));
    assert.ok(!res.ok && res.error.code === "BAD_ARGS", JSON.stringify(args)?.slice(0, 40));
  }
  assert.equal(f.calls.length, 0);
  const full = await runBatch({ calls: Array.from({ length: MAX_BATCH }, () => ({ op: "getWallet" })) }, ctx(fake()));
  assert.ok(full.ok, "the largest allowed batch runs");
});

await t("each call in a batch meets the admin's switches on its own", async () => {
  const f = fake();
  const res = await runBatch({ calls: [{ op: "getWallet" }, { op: "listMyTasks" }] }, ctx(f, { controls: controlsWith({ maintenance: true }) }));
  assert.ok(res.ok);
  assert.ok((res.data as Array<{ ok: boolean; error?: { code: string } }>).every((r) => !r.ok && r.error?.code === "MAINTENANCE"));
  assert.equal(f.calls.length, 0);
});

await t("one failing read does not spoil the rest of its batch", async () => {
  const f = fake((c) => (c.table === "wallets" ? { data: null, error: { message: "boom", code: "XX000" } } : { data: [{ id: "row" }], error: null }));
  const res = await runBatch({ calls: [{ op: "getWallet" }, { op: "listMyTasks" }] }, ctx(f));
  assert.ok(res.ok);
  const [wallet, tasks] = res.data as Array<{ ok: boolean }>;
  assert.ok(!wallet.ok && tasks.ok);
});

await t("the app only batches operations the server treats as reads", () => {
  for (const op of BATCHABLE_OPS) {
    assert.ok(Object.prototype.hasOwnProperty.call(OPS, op), op + " exists on the server");
    assert.equal(rateBucket(op), "read", op + " is a read");
  }
  assert.ok(BATCHABLE_OPS.size > 30);
});

await t("a batch counts against the limiter once per call, capped at the batch size", () => {
  assert.equal(rateCost("getWallet", {}), 1);
  assert.equal(rateCost("batch", { calls: [{}, {}, {}] }), 3);
  assert.equal(rateCost("batch", { calls: Array.from({ length: 99 }, () => ({})) }), MAX_BATCH);
  for (const args of [undefined, {}, { calls: "x" }, { calls: [] }]) assert.equal(rateCost("batch", args), 1);
  assert.equal(rateBucket("batch"), "read");
  assert.deepEqual(batchCalls({ calls: [{ op: "getWallet", args: [1] }] }), [{ op: "getWallet", args: {} }]);
});

await t("a request spends its whole cost in one limiter call (eng review R1)", async () => {
  const f = fake((c) => (c.rpc === "api_rate_spend" ? { data: true, error: null } : { data: null, error: null }));
  const batch = { calls: Array.from({ length: MAX_BATCH }, () => ({ op: "getWallet" })) };
  const res = await spendRate(f.db as never, UID, rateBucket("batch"), rateCost("batch", batch));
  assert.equal(res.data, true);
  assert.equal(f.calls.length, 1, "one database call, not one per read");
  assert.deepEqual(f.calls[0].args, { p_user: UID, p_bucket: "read", p_limit: RATE_LIMITS.read, p_cost: MAX_BATCH });
  const w = fake();
  await spendRate(w.db as never, UID, rateBucket("payTaskFromWallet"), rateCost("payTaskFromWallet", {}));
  assert.deepEqual(w.calls[0].args, { p_user: UID, p_bucket: "write", p_limit: RATE_LIMITS.write, p_cost: 1 });
});

await t("nonsense amounts, dates, places and reserved names are refused (break-it findings, 2026-10-24)", async () => {
  const task = { pillar: "services", title: "Fix tap", benchmarkMinor: 5000, timeLimitMinutes: 30 };
  const refused = async (op: string, args: Record<string, unknown>) => {
    const f = fake();
    const r = await runOp(op, args, ctx(f));
    assert.equal(r.ok, false, op + " " + JSON.stringify(args));
    if (!r.ok) assert.equal(r.error.code, "BAD_ARGS", op + " " + JSON.stringify(args));
    assert.ok(f.calls.every((c) => c.steps.length === 0), op + " must not write anything");
  };
  // A request or an offer for nothing, or for a negative or fractional amount.
  for (const priceMinor of [0, -1, 0.5, "100"]) await refused("placeBid", { taskId: TASK, priceMinor, timeLimitMinutes: 60 });
  await refused("updateBid", { bidId: BID, priceMinor: 0, timeLimitMinutes: 60 });
  // The smallest amount is ₹20 (owner decision 2026-10-25): ₹19.99 is refused with words a person can act on.
  for (const priceMinor of [1, 1999]) {
    const r = await runOp("placeBid", { taskId: TASK, priceMinor, timeLimitMinutes: 60 }, ctx(fake()));
    assert.equal(r.ok, false, String(priceMinor));
    if (!r.ok) assert.match(r.error.message, /smallest amount is ₹20/);
  }
  assert.equal((await runOp("placeBid", { taskId: TASK, priceMinor: 2000, timeLimitMinutes: 60 }, ctx(fake()))).ok, true, "exactly ₹20 is allowed");
  assert.equal((await runOp("updateBid", { bidId: BID, priceMinor: 1999, timeLimitMinutes: 60 }, ctx(fake()))).ok, false);
  assert.equal((await runOp("createTask", { ...task, benchmarkMinor: 1999 }, ctx(fake()))).ok, false);
  assert.equal((await runOp("createTask", { ...task, benchmarkMinor: 2000 }, ctx(fake()))).ok, true);
  assert.equal(packageRules.PRICE_LIMITS.MIN_MINOR, serverRules.PRICE_LIMITS.MIN_MINOR, "the server's copy of the minimum matches packages/rules");
  // The top-up (2026-11-01): only the bar's own steps, 0 when the old app leaves it out.
  assert.deepEqual([...packageRules.TOP_UP_PCTS], [...serverRules.TOP_UP_PCTS], "the server's copy of the top-up steps matches packages/rules");
  let f2 = fake();
  await runOp("createTask", task, ctx(f2));
  assert.equal(inserted(f2.calls[0]).topup_pct, 0);
  f2 = fake();
  assert.equal((await runOp("createTask", { ...task, topUpPct: 10 }, ctx(f2))).ok, true);
  assert.equal(inserted(f2.calls[0]).topup_pct, 10);
  for (const topUpPct of [1, 30, -5, "5", 2.5]) await refused("createTask", { ...task, topUpPct });
  await refused("createTask", { ...task, benchmarkMinor: 0 });
  // A service listing may still start at zero while it is being set up.
  const ok = await runOp("createTask", { ...task, benchmarkMinor: 0, kind: "service" }, ctx(fake()));
  assert.equal(ok.ok, true);
  // A deadline already gone, or years away; a place that is not on Earth.
  await refused("createTask", { ...task, dueAt: "1999-01-01T00:00:00Z" });
  await refused("createTask", { ...task, dueAt: "9999-12-31T00:00:00Z" });
  await refused("createTask", { ...task, locLat: 999, locLng: 999 });
  await refused("createTask", { ...task, locLat: 12, locLng: 181 });
  await refused("updateProfile", { locLat: 91, locLng: 0 });
  assert.equal((await runOp("createTask", { ...task, dueAt: new Date(Date.now() + 86_400_000).toISOString(), locLat: 17.45, locLng: 78.39 }, ctx(fake()))).ok, true);
  // Names that pass for the team or the product.
  for (const username of ["admin", "Support", "TASKDROP", "official"]) {
    const f = fake();
    const r = await runOp("updateProfileExtras", { username }, ctx(f));
    assert.equal(r.ok, false, username);
    assert.equal(f.calls.length, 0, username);
  }
  assert.equal((await runOp("updateProfileExtras", { username: "ravi_fixes" }, ctx(fake()))).ok, true);
});

await t("a typed door address stays private: only the area is published (P2-21, 2026-10-24)", async () => {
  const f = fake();
  const full = "Flat 402, Test Towers, Road 5, Near the park, Madhapur, Ward 104 Kondapur, Greater Hyderabad Municipal Corporation West Zone";
  const r = await runOp("createTask", { pillar: "services", title: "Move a sofa", benchmarkMinor: 5000, timeLimitMinutes: 60, locLabel: full, locLat: 17.4506, locLng: 78.3928 }, ctx(f));
  assert.equal(r.ok, true);
  const insert = f.calls.find((c) => c.table === "tasks")!.steps.find(([n]) => n === "insert")![1][0] as { loc_label: string };
  assert.equal(insert.loc_label, "Kondapur, Greater Hyderabad Municipal Corporation West Zone", "the public label is the area");
  assert.ok(!/Flat 402|Test Towers/.test(JSON.stringify(insert)), "no door-level text in the published row");
  const keep = f.calls.find((c) => c.rpc === "set_task_address");
  assert.ok(keep, "the full line went to the owner-only table");
  assert.deepEqual((keep!.args as Record<string, unknown>).p_address, full);
  // A plain area, or no place, stores nothing private.
  const g = fake();
  await runOp("createTask", { pillar: "services", title: "Move a sofa", benchmarkMinor: 5000, timeLimitMinutes: 60, locLabel: "Madhapur, Hyderabad" }, ctx(g));
  assert.equal(g.calls.some((c) => c.rpc === "set_task_address"), false);
  // The same on a profile: the area only.
  const h = fake();
  await runOp("updateProfile", { locLabel: "2222, Ward 104 Kondapur" }, ctx(h));
  const patch = h.calls.find((c) => c.table === "profiles")!.steps.find(([n]) => n === "update")![1][0] as { loc_label: string };
  assert.equal(patch.loc_label, "Kondapur");
});

await t("poster options: only the ones switched on are sent, and a crew is one row per helper (migration 134)", async () => {
  const base = { pillar: "services", title: "Shift a 2BHK", benchmarkMinor: 360000, timeLimitMinutes: 300 };
  // A plain post inserts exactly the row it always did.
  const plain = fake();
  await runOp("createTask", base, ctx(plain));
  const row = inserted(plain.calls[0]);
  for (const k of ["flash_until", "live_answer", "repeat_every", "preferred_worker_id", "want_photos", "photos_public", "crew_id"]) {
    assert.equal(k in row, false, k);
  }
  // Switched on: sent; photos are only public when asked for at all.
  const on = fake();
  await runOp("createTask", { ...base, repeatEvery: "week", preferWorkerId: OTHER, photosPublic: true }, ctx(on));
  const r2 = inserted(on.calls[0]);
  assert.equal(r2.repeat_every, "week");
  assert.equal(r2.preferred_worker_id, OTHER);
  assert.equal("photos_public" in r2, false);
  assert.equal((await runOp("createTask", { ...base, repeatEvery: "daily" }, ctx(fake()))).ok, false);
  // A crew of 3 splits ₹3,600 into three rows of ₹1,200 sharing one crew id.
  const crew = fake();
  await runOp("createTask", { ...base, crewSize: 3 }, ctx(crew));
  const slots = steps(crew.calls[0], "insert")[0][0] as Record<string, unknown>[];
  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map((s) => s.benchmark_minor), [120000, 120000, 120000]);
  assert.deepEqual(slots.map((s) => s.crew_slot), [1, 2, 3]);
  assert.equal(new Set(slots.map((s) => s.crew_id)).size, 1);
  // Too little for each helper is refused before anything is written.
  const thin = fake();
  assert.equal((await runOp("createTask", { ...base, benchmarkMinor: 3000, crewSize: 5 }, ctx(thin))).ok, false);
  assert.equal(thin.calls.length, 0);
});

// ------------------------------------------------------------- front door --

await t("promotionTiers reads the two settings through the gateway, as stored", async () => {
  const f = fake((c) =>
    c.table === "settings"
      ? { data: [{ key: "promotion_daily_budgets_minor", value: [5000, 8000] }, { key: "promotion_durations_days", value: [1, 3] }], error: null }
      : { data: [], error: null }
  );
  const r = await runOp("promotionTiers", {}, ctx(f));
  assert.deepEqual(r, { ok: true, data: { budgetsMinor: [5000, 8000], days: [1, 3] } });
  assert.deepEqual(steps(f.calls[0], "in")[0], ["key", ["promotion_daily_budgets_minor", "promotion_durations_days"]]);
  // Nothing stored yet: nulls, and the app keeps its defaults.
  const empty = await runOp("promotionTiers", {}, ctx(fake(() => ({ data: [], error: null }))));
  assert.deepEqual(empty, { ok: true, data: { budgetsMinor: null, days: null } });
  assert.equal(rateBucket("promotionTiers"), "read");
});

await t("the app's trace id is kept when it looks like one, replaced otherwise", () => {
  const made = () => "made-here-1234";
  assert.equal(requestIdFrom(new Headers({ [REQUEST_ID_HEADER]: "3f2b9c1e-aaaa-4bbb-8ccc-1234567890ab" }), made), "3f2b9c1e-aaaa-4bbb-8ccc-1234567890ab");
  assert.equal(requestIdFrom(new Headers(), made), "made-here-1234");
  assert.equal(requestIdFrom(new Headers({ [REQUEST_ID_HEADER]: "short" }), made), "made-here-1234");
  assert.equal(requestIdFrom(new Headers({ [REQUEST_ID_HEADER]: "x".repeat(65) }), made), "made-here-1234");
  assert.equal(requestIdFrom(new Headers({ [REQUEST_ID_HEADER]: "abc def-ghij-klmn" }), made), "made-here-1234");
  assert.match(requestIdFrom(new Headers()), /^[0-9a-f-]{36}$/);
});

await t("every answer carries the trace id and is never cached", async () => {
  const res = withGatewayHeaders(new Response("{}", { status: 429, headers: { "Content-Type": "application/json" } }), "req-12345678");
  assert.equal(res.status, 429);
  assert.equal(res.headers.get(REQUEST_ID_HEADER), "req-12345678");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Access-Control-Expose-Headers"), REQUEST_ID_HEADER);
  assert.equal(res.headers.get("Content-Type"), "application/json");
  assert.equal(await res.text(), "{}");
});

await t("a body over the cap is refused, declared or not", async () => {
  const small = await readBody(new Request("https://x/", { method: "POST", body: JSON.stringify({ op: "getTask" }) }));
  assert.deepEqual(small, { ok: true, text: '{"op":"getTask"}' });
  const declared = new Request("https://x/", { method: "POST", body: "{}", headers: { "content-length": String(MAX_BODY_BYTES + 1) } });
  assert.deepEqual(await readBody(declared), { ok: false, reason: "too_large" });
  // A stream that never says how long it is gets cut off as it crosses the cap.
  const chunk = new Uint8Array(64 * 1024).fill(97);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent++ < 10) c.enqueue(chunk);
      else c.close();
    },
  });
  const req = new Request("https://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  assert.deepEqual(await readBody(req), { ok: false, reason: "too_large" });
  assert.ok(sent <= 7, "stopped reading soon after the cap");
  // Exactly at the cap is fine; multi-byte text survives being put back together.
  assert.equal((await readBody(new Request("https://x/", { method: "POST", body: "₹".repeat(1000) }))).ok, true);
  const exact = await readBody(new Request("https://x/", { method: "POST", body: "a".repeat(MAX_BODY_BYTES) }));
  assert.equal(exact.ok && exact.text.length, MAX_BODY_BYTES);
});

// ------------------------------------------------------------- repeat keys --

/** A store kept in memory, shaped like migration 139's two functions. */
function memoryStore() {
  const rows = new Map<string, { op: string; hash: string; reply: unknown }>();
  const store: RepeatStore & { rows: typeof rows; claims: number } = {
    rows,
    claims: 0,
    async claim(key, op, hash) {
      store.claims++;
      const row = rows.get(key);
      if (!row) {
        rows.set(key, { op, hash, reply: null });
        return { state: "new" };
      }
      if (row.op !== op || row.hash !== hash) return { state: "mismatch" };
      return row.reply === null ? { state: "running" } : { state: "done", reply: row.reply as never };
    },
    async save(key, reply) {
      const row = rows.get(key);
      if (row && row.reply === null) row.reply = reply;
    },
  };
  return store;
}

await t("a repeat key must look like one; none at all is fine", () => {
  assert.equal(repeatKeyFrom(new Headers()), null);
  assert.equal(repeatKeyFrom(new Headers({ [REPEAT_KEY_HEADER]: "3f2b9c1e-aaaa-4bbb-8ccc-1234567890ab" })), "3f2b9c1e-aaaa-4bbb-8ccc-1234567890ab");
  assert.equal(repeatKeyFrom(new Headers({ [REPEAT_KEY_HEADER]: "short" })), "bad");
  assert.equal(repeatKeyFrom(new Headers({ [REPEAT_KEY_HEADER]: "x".repeat(65) })), "bad");
  assert.equal(repeatKeyFrom(new Headers({ [REPEAT_KEY_HEADER]: "abc def ghij klmn opqr" })), "bad");
});

await t("the same request gives the same fingerprint, whatever order its fields came in", async () => {
  assert.equal(repeatStableJson({ b: 1, a: [2, { d: 1, c: undefined, b: null }] }), '{"a":[2,{"b":null,"d":1}],"b":1}');
  const one = await requestHash("payTaskFromWallet", { taskId: TASK, note: "x" });
  assert.equal(one, await requestHash("payTaskFromWallet", { note: "x", taskId: TASK }));
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.notEqual(one, await requestHash("payTaskFromWallet", { taskId: TASK2, note: "x" }));
  assert.notEqual(one, await requestHash("startTask", { taskId: TASK, note: "x" }));
});

await t("a write sent twice with one key is done once, and the repeat gets the first reply", async () => {
  const store = memoryStore();
  let runs = 0;
  const run = async () => ({ ok: true as const, data: { id: `payout-${++runs}` } });
  const first = await runOnce(store, "k".repeat(20), "requestWithdrawal", { amountMinor: 50000 }, run);
  const again = await runOnce(store, "k".repeat(20), "requestWithdrawal", { amountMinor: 50000 }, run);
  assert.equal(runs, 1);
  assert.deepEqual(first, { reply: { ok: true, data: { id: "payout-1" } }, status: 200, replayed: false });
  assert.deepEqual(again, { reply: { ok: true, data: { id: "payout-1" } }, status: 200, replayed: true });
  // A new key is a new tap: done again.
  await runOnce(store, "n".repeat(20), "requestWithdrawal", { amountMinor: 50000 }, run);
  assert.equal(runs, 2);
});

await t("a refusal is saved too, so a repeat cannot turn a no into a yes", async () => {
  const store = memoryStore();
  let runs = 0;
  const refusedPay = async () => (runs++, { ok: false as const, error: { message: "Not enough money in your wallet", code: "INSUFFICIENT", details: null } });
  await runOnce(store, "r".repeat(20), "payTaskFromWallet", { taskId: TASK }, refusedPay);
  const again = await runOnce(store, "r".repeat(20), "payTaskFromWallet", { taskId: TASK }, async () => ({ ok: true as const, data: null }));
  assert.equal(runs, 1);
  assert.equal(again.replayed, true);
  assert.equal(again.reply.ok, false);
});

await t("still running, used for something else, or lost: each has its own answer and nothing runs", async () => {
  const store = memoryStore();
  let runs = 0;
  const run = async () => (runs++, { ok: true as const, data: null });
  store.rows.set("s".repeat(20), { op: "lockBid", hash: await requestHash("lockBid", { bidId: BID }), reply: null });
  const running = await runOnce(store, "s".repeat(20), "lockBid", { bidId: BID }, run);
  assert.deepEqual(running, { reply: IN_PROGRESS, status: 409, replayed: false });
  const reused = await runOnce(store, "s".repeat(20), "lockBid", { bidId: OTHER }, run);
  assert.deepEqual(reused, { reply: KEY_REUSED, status: 422, replayed: false });
  const lostStore: RepeatStore = { claim: async () => ({ state: "lost" }), save: async () => {} };
  const lost = await runOnce(lostStore, "l".repeat(20), "lockBid", { bidId: BID }, run);
  // 200 like any refusal, so the app shows it and does not ask again on its own.
  assert.deepEqual(lost, { reply: OUTCOME_UNKNOWN, status: 200, replayed: false });
  assert.equal(runs, 0);
});

await t("if the key store cannot be reached the write still runs, once, as before keys existed", async () => {
  const errors: unknown[] = [];
  let saves = 0;
  const down: RepeatStore = { claim: async () => { throw new Error("db down"); }, save: async () => { saves++; } };
  let runs = 0;
  const out = await runOnce(down, "d".repeat(20), "confirmRelease", { taskId: TASK }, async () => (runs++, { ok: true as const, data: null }), (e) => errors.push(e));
  assert.equal(runs, 1);
  assert.equal(saves, 0, "nothing is saved for a key that was never claimed");
  assert.equal(out.replayed, false);
  assert.equal(errors.length, 1);
  // A reply that cannot be saved is still sent.
  const saveFails: RepeatStore = { claim: async () => ({ state: "new" }), save: async () => { throw new Error("db down"); } };
  const sent = await runOnce(saveFails, "e".repeat(20), "confirmRelease", { taskId: TASK }, async () => ({ ok: true as const, data: 1 }), (e) => errors.push(e));
  assert.deepEqual(sent.reply, { ok: true, data: 1 });
  assert.equal(errors.length, 2);
});

await t("the app's key and the server's agree on what a usable key is", () => {
  const appKey = "3f2b9c1e-aaaa-4bbb-8ccc-1234567890ab"; // crypto.randomUUID(), as randomId() makes
  assert.equal(repeatKeyFrom(new Headers({ [REPEAT_KEY_HEADER]: appKey })), appKey);
  const fallback = "abcd1234-efgh5678-ijkl9012"; // randomId()'s fallback shape
  assert.equal(repeatKeyFrom(new Headers({ [REPEAT_KEY_HEADER]: fallback })), fallback);
  const sql = readFileSync(new URL("../../migrations/20261102160000_139_api_repeat_keys.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("^[A-Za-z0-9_-]{16,64}$"), "the table checks the same shape");
});

// ------------------------------------------------------------- guest mode --

const [G1, G2, G3] = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
];
const HELPER1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const HELPER2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const HELPER3 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const HERE = { lat: 12.97, lng: 77.59 };

/** What guest_open_posts hands back: the far one comes first on purpose, so sorting has to happen. */
const guestPosts = () => [
  { id: G3, poster_id: HELPER3, title: "Far", loc_lat: 28.6, loc_lng: 77.2, poster: { id: HELPER3, name: "Far Poster" } },
  { id: G2, poster_id: HELPER2, title: "Mid", loc_lat: 13.0, loc_lng: 77.62, poster: { id: HELPER2, name: "Mid Poster" } },
  { id: G1, poster_id: HELPER1, title: "Near", loc_lat: 12.971, loc_lng: 77.591, poster: { id: HELPER1, name: "Near Poster" }, benchmark_minor: 500, category: "x" },
];

const SHARED_RPCS = new Set([
  "trending_categories", "platform_highlights", "top_earners", "public_profile_stats", "ad_auction",
]);

/** A fake whose guest SQL functions answer sensibly; `media` is what guest_public_media lets through. */
function guestFake(media: (paths: string[]) => string[] = (p) => p) {
  return fake((c) => {
    if (c.rpc === "guest_open_posts") {
      const a = c.args as { p_ids: string[] | null };
      return { data: guestPosts().filter((p) => !a.p_ids || a.p_ids.includes(p.id)), error: null };
    }
    if (c.rpc === "guest_helpers") {
      return {
        data: [
          { id: HELPER3, loc_lat: 28.6, loc_lng: 77.2, skills: ["a"], last_seen_at: "2026-10-05T09:50:00Z" },
          { id: HELPER2, loc_lat: 13.0, loc_lng: 77.62, skills: ["a"], last_seen_at: "2026-10-05T09:59:00Z" },
          { id: HELPER1, loc_lat: 12.971, loc_lng: 77.591, skills: [], last_seen_at: "2026-10-05T09:00:00Z" },
        ],
        error: null,
      };
    }
    if (c.rpc === "guest_profile") return { data: { id: HELPER1, name: "Near Poster" }, error: null };
    if (c.rpc === "guest_bid_counts") return { data: { [G1]: 2 }, error: null };
    if (c.rpc === "guest_public_media") return { data: media((c.args as { p_paths: string[] }).p_paths), error: null };
    return { data: [], error: null };
  });
}

/** Plausible arguments for each op a guest may run. */
const GUEST_ARGS: Record<string, Record<string, unknown>> = {
  trendingCategories: {}, platformHighlights: {}, topEarners: { kind: "top_rated" },
  platformFees: {}, publicProfileStats: { userId: HELPER1 },
  adAuctionRanks: {},
  listOpenTasks: {}, searchTasks: { q: "clean", near: { ...HERE, radiusKm: 10 } }, searchTasksWithPosters: { q: "clean" },
  attachPosters: { taskIds: [G1, G2] }, getTask: { taskId: G1 }, getTaskDetail: { taskId: G1 },
  countBidsByTask: { taskIds: [G1] }, getPosterStats: { posterId: HELPER1 }, recommendedTasks: { skills: ["clean"] },
  remoteTasks: {}, tasksNear: { ...HERE, radiusKm: 10 }, urgentTasks: {}, workerServices: { userId: HELPER1 },
  workersNear: { ...HERE, radiusKm: 10 }, listActiveWorkers: {}, getProfile: { userId: HELPER1 },
  listReviewsAbout: { userId: HELPER1, role: "worker" }, signMedia: { paths: ["a/1.jpg"] },
  listTaskQuestions: { taskId: G1 }, listFeedbackBoard: { sort: "new" }, getFeedbackPost: { postId: G1 },
  nearbyPulse: { ...HERE, radiusKm: 5 }, workerProofPhotos: { userId: HELPER1 },
};

/** The names inside `export const NAME ... new Set([ ... ])` of the app's guest.ts. */
function appSet(name: string): Set<string> {
  const src = readFileSync(new URL("../../../apps/mobile/src/lib/guest.ts", import.meta.url), "utf8");
  const m = src.match(new RegExp(`export const ${name}\\b[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  assert.ok(m, `${name} not found in apps/mobile/src/lib/guest.ts`);
  return new Set([...m[1].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]));
}

await t("guest: the app's list of guest reads is the server's list", () => {
  const app = appSet("GUEST_OPS");
  const server = Object.keys(GUEST_OPS);
  assert.ok(server.length > 20);
  assert.deepEqual([...app].sort(), [...server].sort());
  for (const name of server) assert.ok(isGuestOp(name), name);
  for (const name of ["constructor", "__proto__", "toString", "createTask", 5, null]) assert.equal(isGuestOp(name), false, String(name));
});

await t("guest: the app's account and quiet write lists are exactly the server's writes, with no overlap", () => {
  const account = appSet("ACCOUNT_WRITES");
  const quiet = appSet("QUIET_WRITES");
  for (const n of account) assert.ok(!quiet.has(n), `${n} is in both lists`);
  const serverWrites = [
    ...Object.keys(WRITE_OPS),
    ...Object.keys(MEDIA_OPS).filter((n) => rateBucket(n) !== "read"),
  ];
  assert.deepEqual([...new Set([...account, ...quiet])].sort(), [...new Set(serverWrites)].sort());
  for (const n of [...account, ...quiet]) assert.equal(isGuestOp(n), false, `${n} is a write but guests may run it`);
});

await t("guest: every guest operation is a read on the server", () => {
  for (const name of Object.keys(GUEST_OPS)) {
    assert.equal(rateBucket(name), "read", name);
    assert.ok(!Object.prototype.hasOwnProperty.call(WRITE_OPS, name), `${name} is a write op`);
  }
  assert.deepEqual(Object.keys(GUEST_ARGS).sort(), Object.keys(GUEST_OPS).sort(), "this test lacks arguments for an op");
});

await t("guest: a write or an unknown name answers NEEDS_ACCOUNT and never touches the database", async () => {
  for (const name of ["createTask", "placeBid", "requestWithdrawal", "sendMessage", "deleteMyAccount", "nope", "constructor", "__proto__", "", null, 7]) {
    const f = guestFake();
    const r = await runGuestOp(name, { taskId: G1 }, ctx(f));
    assert.equal(r.ok, false, String(name));
    if (!r.ok) {
      assert.equal(r.error.code, NEEDS_ACCOUNT_CODE);
      assert.equal(r.error.message, NEEDS_ACCOUNT);
    }
    assert.equal(f.calls.length, 0, `${String(name)} reached the database`);
    assert.equal(f.storageCalls.length, 0);
  }
  assert.equal(NEEDS_ACCOUNT_CODE, "NEEDS_ACCOUNT");
});

await t("guest: reads only use guest_ functions, the shared public functions and the fee settings", async () => {
  for (const name of Object.keys(GUEST_OPS)) {
    const f = guestFake();
    const r = await runGuestOp(name, GUEST_ARGS[name], ctx(f, { userId: undefined }));
    assert.ok(r.ok, `${name}: ${JSON.stringify(r)}`);
    assert.ok(f.calls.length > 0 || name === "signMedia", `${name} made no call`);
    for (const c of f.calls) {
      if (c.rpc) assert.ok(c.rpc.startsWith("guest_") || SHARED_RPCS.has(c.rpc), `${name} called rpc ${c.rpc}`);
      else {
        assert.equal(c.table, "settings", `${name} read table ${c.table}`);
        assert.equal(name, "platformFees", `${name} read settings`);
      }
    }
  }
  // Nothing in the module can reach the private tables, by name.
  const src = readFileSync(new URL("./guest.ts", import.meta.url), "utf8");
  for (const table of ["tasks", "profiles", "task_private", "assignments", "bids"]) {
    assert.ok(!src.includes(`from("${table}")`), `guest.ts reads ${table}`);
  }
});

await t("guest: the task page has no address, no hired helper and no poster inside the task", async () => {
  const f = guestFake();
  const r = await runGuestOp("getTaskDetail", { taskId: G1 }, ctx(f));
  assert.ok(r.ok);
  const d = (r as { data: { task: Record<string, unknown>; address: unknown; assignment: unknown; worker: unknown; poster: { id: string } } }).data;
  assert.equal(d.address, null);
  assert.equal(d.assignment, null);
  assert.equal(d.worker, null);
  assert.equal(d.poster.id, HELPER1);
  assert.equal(d.task.id, G1);
  assert.ok(!("poster" in d.task), "poster must be stripped from the task object");
  const gone = await runGuestOp("getTaskDetail", { taskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, ctx(f));
  assert.deepEqual(gone, { ok: true, data: null });
  const badId = await runGuestOp("getTaskDetail", { taskId: "x" }, ctx(f));
  assert.ok(!badId.ok && badId.error.code === "BAD_ARGS");
});

await t("guest: attachPosters keeps the asked order and drops ids that were not returned", async () => {
  const f = guestFake();
  const missing = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const r = await runGuestOp("attachPosters", { taskIds: [G1, missing, G3, G2] }, ctx(f));
  assert.ok(r.ok);
  const list = (r as { data: { id: string; poster: unknown }[] }).data;
  assert.deepEqual(list.map((p) => p.id), [G1, G3, G2]);
  assert.ok(list.every((p) => p.poster));
  assert.deepEqual(await runGuestOp("attachPosters", { taskIds: [] }, ctx(f)), { ok: true, data: [] });
});

await t("guest: tasksNear and workersNear keep only what is in range, nearest first", async () => {
  const f = guestFake();
  const r = await runGuestOp("tasksNear", { ...HERE, radiusKm: 10, limit: 10 }, ctx(f));
  assert.ok(r.ok);
  const tasks = (r as { data: { id: string; km: number }[] }).data;
  assert.deepEqual(tasks.map((x) => x.id), [G1, G2]);
  assert.ok(tasks[0].km < tasks[1].km && tasks[1].km <= 10);
  const tight = await runGuestOp("tasksNear", { ...HERE, radiusKm: 1 }, ctx(f));
  assert.deepEqual((tight as { data: { id: string }[] }).data.map((x) => x.id), [G1]);
  const capped = await runGuestOp("tasksNear", { ...HERE, radiusKm: 10000, limit: 2 }, ctx(f));
  assert.deepEqual((capped as { data: { id: string }[] }).data.map((x) => x.id), [G1, G2]);

  const w = await runGuestOp("workersNear", { ...HERE, radiusKm: 10 }, ctx(f));
  assert.ok(w.ok);
  const near = (w as { data: { id: string; km: number; top_service: { id: string } | null; service_count: number }[] }).data;
  assert.deepEqual(near.map((x) => x.id), [HELPER1, HELPER2]);
  assert.ok(near[0].km < near[1].km);
  assert.equal(near[0].service_count, 1);
  assert.equal(near[0].top_service?.id, G1);
});

await t("guest: questions, ideas, pulse and proof photos go through their migration-151 guest functions", async () => {
  const want: Record<string, [string, Record<string, unknown>]> = {
    listTaskQuestions: ["guest_task_questions", { p_task: G1 }],
    listFeedbackBoard: ["guest_feedback_board_list", { p_sort: "new", p_status: null, p_category: null, p_search: null, p_limit: 30, p_offset: 0 }],
    getFeedbackPost: ["guest_feedback_board_get", { p_post: G1 }],
    nearbyPulse: ["guest_nearby_pulse", { p_lat: HERE.lat, p_lng: HERE.lng, p_radius_km: 5 }],
    workerProofPhotos: ["guest_proof_photos", { p_worker: HELPER1 }],
  };
  for (const [name, [rpc, args]] of Object.entries(want)) {
    const f = guestFake();
    const r = await runGuestOp(name, GUEST_ARGS[name], ctx(f, { userId: undefined }));
    assert.equal(r.ok, true, name);
    const calls = f.calls.filter((c) => c.rpc);
    assert.equal(calls.length, 1, name);
    assert.equal(calls[0].rpc, rpc, name);
    assert.deepEqual(calls[0].args, args, name);
  }
  // Out-of-range input is refused before any query.
  const f = guestFake();
  const bad = await runGuestOp("nearbyPulse", { ...HERE, radiusKm: 500 }, ctx(f, { userId: undefined }));
  assert.equal(bad.ok, false);
  assert.equal(f.calls.filter((c) => c.rpc).length, 0);
});

await t("guest: signMedia signs only the pictures guest_public_media allows", async () => {
  const f = guestFake((p) => p.filter((x) => x !== "private/2.jpg"));
  const r = await runGuestOp("signMedia", { paths: ["pub/1.jpg", "private/2.jpg", "pub/3.jpg", "pub/1.jpg"] }, ctx(f));
  assert.ok(r.ok);
  const ask = f.calls.find((c) => c.rpc === "guest_public_media")!;
  assert.deepEqual((ask.args as { p_paths: string[] }).p_paths, ["pub/1.jpg", "private/2.jpg", "pub/3.jpg"]);
  assert.equal(f.storageCalls.length, 1);
  assert.deepEqual(steps(f.storageCalls[0], "createSignedUrls")[0][0], ["pub/1.jpg", "pub/3.jpg"]);
  assert.deepEqual(Object.keys((r as { data: Record<string, string> }).data).sort(), ["pub/1.jpg", "pub/3.jpg"]);

  const none = guestFake(() => []);
  assert.deepEqual(await runGuestOp("signMedia", { paths: ["private/2.jpg"] }, ctx(none)), { ok: true, data: {} });
  assert.equal(none.storageCalls.length, 0, "nothing allowed means nothing signed");
  const empty = guestFake();
  assert.deepEqual(await runGuestOp("signMedia", { paths: [] }, ctx(empty)), { ok: true, data: {} });
  assert.equal(empty.calls.length, 0);
  const bad = await runGuestOp("signMedia", { paths: "a" }, ctx(empty));
  assert.ok(!bad.ok && bad.error.code === "BAD_ARGS");
});

await t("guest: a batch runs each read and answers NEEDS_ACCOUNT for a write inside it", async () => {
  const f = guestFake();
  const r = await runGuestBatch({ calls: [{ op: "getTask", args: { taskId: G1 } }, { op: "placeBid", args: { taskId: G1 } }, { op: "platformHighlights" }] }, ctx(f));
  assert.ok(r.ok);
  const out = (r as { data: { ok: boolean; error?: { code: string } }[] }).data;
  assert.equal(out.length, 3);
  assert.equal(out[0].ok, true);
  assert.equal(out[1].ok, false);
  assert.equal(out[1].error?.code, NEEDS_ACCOUNT_CODE);
  assert.equal(out[2].ok, true);
  assert.ok(!f.calls.some((c) => c.table), "the write reached a table");
  const tooMany = await runGuestBatch({ calls: Array.from({ length: MAX_BATCH + 1 }, () => ({ op: "platformHighlights" })) }, ctx(guestFake()));
  assert.ok(!tooMany.ok && tooMany.error.code === "BAD_ARGS");
  const junk = await runGuestBatch({ calls: "x" }, ctx(guestFake()));
  assert.ok(!junk.ok);
});

await t("guest: the rate key looks like a lowercase uuid, is stable, differs per address and hides the address", async () => {
  const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
  const a = await guestRateKey("203.0.113.7");
  assert.match(a, shape);
  assert.equal(await guestRateKey("203.0.113.7"), a);
  const b = await guestRateKey("203.0.113.8");
  assert.match(b, shape);
  assert.notEqual(a, b);
  assert.ok(!a.includes("203"), "the address must not appear");
  assert.equal(await guestRateKey(""), await guestRateKey(""));
  assert.match(await guestRateKey(""), shape);
  assert.equal(guestAddress(new Headers({ "cf-connecting-ip": " 1.2.3.4 ", "x-forwarded-for": "9.9.9.9" })), "1.2.3.4");
  assert.equal(guestAddress(new Headers({ "x-forwarded-for": "5.6.7.8, 9.9.9.9" })), "5.6.7.8");
  assert.equal(guestAddress(new Headers()), "");
});

await t("guest: only the public key with no person behind it is a guest token", () => {
  assert.equal(isGuestToken("anon-key", "anon-key", null), true);
  assert.equal(isGuestToken("other", "anon-key", { data: { claims: { role: "anon" } }, error: null }), true);
  assert.equal(isGuestToken("other", "anon-key", { data: { claims: { role: "anon", sub: UID } }, error: null }), false);
  assert.equal(isGuestToken("other", "anon-key", { data: { claims: { role: "authenticated", sub: UID } }, error: null }), false);
  assert.equal(isGuestToken("other", "anon-key", { data: null, error: new Error("bad") }), false);
  assert.equal(isGuestToken("other", "anon-key", { data: { claims: { role: "anon" } }, error: new Error("bad") }), false);
  assert.equal(isGuestToken("", "", null), false, "an empty token is never the anon key");
  assert.equal(isGuestToken("x", "anon-key", null), false);
});

await t("guest: the admin panel's maintenance and update switches also stop a guest's reads", async () => {
  for (const patch of [{ maintenance: true, maintenance_message: "Back at 6pm" }, { update_required: true, min_version: "2.0.0" }]) {
    const f = guestFake();
    const r = await runGuestOp("listOpenTasks", {}, ctx(f, { controls: controlsWith(patch) }));
    assert.ok(!r.ok);
    if (!r.ok) assert.ok(["MAINTENANCE", "UPDATE_REQUIRED"].includes(r.error.code));
    assert.equal(f.calls.length, 0);
  }
  const ok = await runGuestOp("listOpenTasks", {}, ctx(guestFake(), { controls: controlsWith() }));
  assert.ok(ok.ok);
  const unreadable = await runGuestOp("listOpenTasks", {}, ctx(guestFake(), { controls: null }));
  assert.ok(unreadable.ok, "unreadable switches never refuse");
});

console.log(`\n${passed} passed`);
