/**
 * Tests for the api function's operations, against a fake database.
 *
 * Run from the repo root with Node 22+:
 *   node --experimental-transform-types --no-warnings supabase/functions/api/api.test.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { OPS, RATE_LIMITS, rateBucket, runOp } from "./ops.ts";
import * as serverRules from "../_shared/rules.ts";
import * as packageRules from "../../../packages/rules/src/index.ts";

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
  await runOp("placeBid", { taskId: TASK, workerId: OTHER, priceMinor: 500, timeLimitMinutes: 60, message: " hi " }, ctx(f));
  assert.equal(inserted(f.calls[0]).worker_id, UID);
  assert.equal(inserted(f.calls[0]).message, "hi");

  f = fake();
  await runOp("createTask", { posterId: OTHER, pillar: "services", title: "Fix tap", benchmarkMinor: 100, timeLimitMinutes: 30 }, ctx(f));
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
  const rls = await runOp("placeBid", { taskId: TASK, priceMinor: 1, timeLimitMinutes: 1 }, ctx(fake(() => ({ data: null, error: { message: 'new row violates row-level security policy for table "bids"', code: "42501" } }))));
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

console.log(`\n${passed} passed`);
