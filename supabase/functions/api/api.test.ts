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
import {
  ControlsCache, featureOffMessage, OPEN_CONFIG, parseControls, publicConfig, readClient, refusalFor, type Controls,
} from "../_shared/controls.ts";
import * as serverRules from "../_shared/rules.ts";
import type { ImageKitConfig } from "../_shared/imagekit.ts";
import { createHmac } from "node:crypto";
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
  await refused("placeBid", { taskId: TASK, priceMinor: 500, timeLimitMinutes: 60, message: PHONE });
  await refused("updateBid", { bidId: BID, priceMinor: 500, timeLimitMinutes: 60, message: "mail me a@b.com" });
  await refused("createTask", { pillar: "services", title: "Fix tap", benchmarkMinor: 100, timeLimitMinutes: 30, description: PHONE });
  await refused("createTask", { pillar: "services", title: "Fix tap at flat 12B", benchmarkMinor: 100, timeLimitMinutes: 30 });
  await refused("updateListing", { id: TASK, title: "Tap repair", description: "www.example.com", priceMinor: 100, deliveryDays: 1 });
  await refused("submitProof", { taskId: TASK, summary: PHONE, files: [] });
  await refused("updateProfile", { displayName: "98765 43210 ravi" });
  await refused("updateProfileExtras", { bio: PHONE });
  await refused("updateProfileExtras", { workerBio: PHONE });
  await refused("updateProfileExtras", { username: "a@b.com" });
  // Ordinary text goes through, and the app's own already-masked text is fine.
  const f = fake(() => ({ data: [{ id: "row" }], error: null }));
  const ok = await runOp("placeBid", { taskId: TASK, priceMinor: 500, timeLimitMinutes: 60, message: "Can do it tomorrow, ••• for details" }, ctx(f));
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
  const task = { pillar: "x", title: "Fix a tap", benchmarkMinor: 100, timeLimitMinutes: 60 };
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
  const bid = await runOp("placeBid", { taskId: TASK, priceMinor: 1, timeLimitMinutes: 1 }, ctx(fake(), { controls: controlsWith({ posting: false, withdrawals: false }) }));
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

console.log(`\n${passed} passed`);
