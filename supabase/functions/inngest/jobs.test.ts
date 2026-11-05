/**
 * Tests for the Inngest jobs' logic, against a fake database.
 *
 * Run from the repo root with Node 22+ (also part of `npm test`):
 *   node --experimental-strip-types --no-warnings --test supabase/functions/inngest/jobs.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALERT_EVENTS, alertFor, call, checkSnapshotFreshness, chunk, compareProviderPayment, deadKeys, digestAlert, expoReceipts, expoSend, ownFiles,
  readTickets, refreshPublicSnapshots, safeData, saveAlert, toEvents, tokenKey, tokensForKeys, userSyncArgs, USER_EVENTS, type Fetch, type Rpc, type SnapshotMarker,
} from "./jobs.ts";

test("outbox rows become Inngest events keyed by the outbox id", () => {
  const events = toEvents([
    { id: "a1", kind: "support.opened", data: { category: "payment" }, created_at: "2026-10-12T00:00:00Z" },
    { id: "b2", kind: "user.signed_up", data: undefined as never, created_at: "2026-10-12T00:00:01Z" },
  ]);
  assert.deepEqual(events, [
    { id: "a1", name: "taskdrop/support.opened", data: { category: "payment" } },
    { id: "b2", name: "taskdrop/user.signed_up", data: {} },
  ]);
});

test("every alerting event has an alert, and nothing else does", () => {
  for (const name of ALERT_EVENTS) {
    assert.ok(alertFor(name, {}), `${name} should alert`);
  }
  assert.equal(alertFor("taskdrop/user.signed_up", { name: "A" }), null);
  assert.equal(alertFor("taskdrop/user.deleted", {}), null);
  assert.equal(alertFor("taskdrop/something.else", {}), null);
});

test("alert wording carries the facts and survives missing fields", () => {
  const w = alertFor("taskdrop/withdrawal.requested", { amount_rupees: 12500, name: "Asha", via: "UPI" });
  assert.equal(w?.title, "Withdrawal requested: ₹12,500");
  assert.equal(w?.body, "Asha via UPI");

  const f = alertFor("taskdrop/payout.failed", { amount_rupees: 499.5, name: "Ravi" });
  assert.equal(f?.kind, "payout_failed");
  assert.equal(f?.title, "Payout failed: ₹499.5");
  assert.equal(f?.body, "Ravi. Open Payouts to see why.");

  const d = alertFor("taskdrop/dispute.opened", {});
  assert.equal(d?.title, "Dispute opened");
  assert.equal(d?.body, "Poster: someone. Open Disputes to decide.");

  const s = alertFor("taskdrop/support.opened", { from: "Meera", category: "payment" });
  assert.equal(s?.title, "New help request");
  assert.equal(s?.body, "Meera · payment. Open Help requests to read it.");
});

test("text a person typed never reaches an alert or its stored data, even from an old queued event", () => {
  const old = {
    subject: "Call me on 9876543210",
    reason: "UPI id asha@okbank not found",
    title: "Fix the flat at 12 Cross Road",
    from: "Meera",
    name: "Ravi",
    poster: "Asha",
    category: "payment",
    amount_rupees: 100,
    ticket_id: "t1",
  };
  for (const name of ["support.opened", "payout.failed", "dispute.opened"]) {
    const a = alertFor("taskdrop/" + name, old);
    assert.ok(a, name);
    assert.doesNotMatch(`${a?.title} ${a?.body}`, /9876543210|asha@okbank|Cross Road|Call me|not found/, name);
  }
  const kept = safeData(old);
  assert.deepEqual(Object.keys(kept).sort(), ["amount_rupees", "category", "from", "name", "poster", "ticket_id"]);
  assert.doesNotMatch(JSON.stringify(kept), /9876543210|asha@okbank|Cross Road/);
});

test("the daily digest reads as totals", () => {
  const a = digestAlert({
    date: "2026-10-12", people_total: 40, new_people: 3, jobs_posted: 7, jobs_finished: 5,
    earned_rupees: 1234.5, withdrawals_waiting: 2, withdrawals_waiting_rupees: 800, open_disputes: 1, open_help_requests: 4,
  });
  assert.equal(a.kind, "digest");
  assert.equal(a.title, "Daily digest, 2026-10-12");
  const lines = a.body.split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines[0], /3 new people \(40 in all\)/);
  assert.match(lines[2], /₹1,234.5/);
  assert.match(lines[3], /2 withdrawals waiting \(₹800\)/);
});

test("a database error is thrown so Inngest retries the step", async () => {
  const bad: Rpc = async () => ({ data: null, error: { message: "boom" } });
  await assert.rejects(() => call(bad, "outbox_pending"), /outbox_pending: boom/);
});

test("saveAlert passes the alert to record_admin_alert and returns its id", async () => {
  const seen: Array<[string, Record<string, unknown> | undefined]> = [];
  const ok: Rpc = async (name, args) => {
    seen.push([name, args]);
    return { data: "alert-id", error: null };
  };
  const id = await saveAlert(ok, { kind: "dispute", title: "T", body: "B" }, { task_id: "x" });
  assert.equal(id, "alert-id");
  assert.deepEqual(seen, [["record_admin_alert", { p_kind: "dispute", p_title: "T", p_body: "B", p_data: { task_id: "x" } }]]);
});

test("our payment is compared with Razorpay's payment link", () => {
  const ours = (status: string, amount_minor = 50000) => ({ id: "p1", provider_ref: "plink_1", status, amount_minor, created_at: "2026-10-17T00:00:00Z" });
  assert.equal(compareProviderPayment(ours("paid"), { status: "paid", amount: 50000 }), null);
  assert.equal(compareProviderPayment(ours("created"), { status: "created", amount: 50000 }), null);
  assert.equal(compareProviderPayment(ours("created"), { status: "expired", amount: 50000 }), null, "expired is not a disagreement");
  assert.equal(compareProviderPayment(ours("cancelled"), { status: "cancelled" }), null);
  assert.match(compareProviderPayment(ours("created"), { status: "paid", amount: 50000 })?.note ?? "", /Razorpay says paid/);
  assert.match(compareProviderPayment(ours("paid"), { status: "created", amount: 50000 })?.note ?? "", /We say paid/);
  assert.match(compareProviderPayment(ours("paid"), { status: "paid", amount: 49900 })?.note ?? "", /amount differs/);
  assert.equal(compareProviderPayment(ours("paid"), null)?.theirs, "not found");
});

// ---------------------------------------------------------------------- push --

const T1 = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const T2 = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";
const T3 = "ExponentPushToken[cccccccccccccccccccccc]";

const reply = (status: number, body: unknown): Fetch => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("a device token never appears in what a step would hand back", async () => {
  const key = await tokenKey(T1);
  assert.match(key, /^[0-9a-f]{16}$/);
  assert.ok(!key.includes("aaaa"));
  assert.equal(key, await tokenKey(T1));
  assert.notEqual(key, await tokenKey(T2));
});

test("sending: ok tickets wait for a receipt, gone devices are named, the rest count as failed", async () => {
  const msgs = [{ to: T1 }, { to: T2 }, { to: T3 }];
  const out = await readTickets(msgs, [
    { status: "ok", id: "tk1" },
    { status: "error", details: { error: "DeviceNotRegistered" } },
    { status: "error", details: { error: "MessageRateExceeded" } },
  ]);
  assert.deepEqual(out.waiting, [{ id: "tk1", key: await tokenKey(T1) }]);
  assert.deepEqual(out.dead, [T2]);
  assert.equal(out.failed, 1);
  // Expo returning fewer tickets than messages is a failure, never a crash.
  assert.equal((await readTickets(msgs, [])).failed, 3);
});

test("receipts: only a DeviceNotRegistered error removes a device, and it is matched back by key", async () => {
  const waiting = [
    { id: "r1", key: await tokenKey(T1) },
    { id: "r2", key: await tokenKey(T2) },
    { id: "r3", key: await tokenKey(T3) },
  ];
  const keys = deadKeys(waiting, {
    r1: { status: "ok" },
    r2: { status: "error", details: { error: "DeviceNotRegistered" } },
    r3: { status: "error", details: { error: "MessageTooBig" } },
  });
  assert.deepEqual(keys, [await tokenKey(T2)]);
  assert.deepEqual(await tokensForKeys([T1, T2, T3], keys), [T2]);
  assert.deepEqual(await tokensForKeys([T1, T3], keys), []);   // the device is already gone
});

test("Expo calls: an HTTP error is thrown so Inngest retries; a malformed body is empty, not a crash", async () => {
  await assert.rejects(() => expoSend(reply(503, {}), [{ to: T1 }]), /HTTP 503/);
  await assert.rejects(() => expoReceipts(reply(500, {}), ["a"]), /HTTP 500/);
  assert.deepEqual(await expoSend(reply(200, { data: "nope" }), [{ to: T1 }]), []);
  assert.deepEqual(await expoReceipts(reply(200, {}), ["a"]), {});
  assert.deepEqual(await expoSend(reply(200, { data: [{ status: "ok", id: "x" }] }), [{ to: T1 }]), [{ status: "ok", id: "x" }]);
});

test("deleted-account files: only the person's own folder, never a path that climbs out", () => {
  const uid = "11111111-1111-1111-1111-111111111111";
  assert.deepEqual(
    ownFiles(uid, [`${uid}/a.jpg`, `${uid}/../22222222/b.jpg`, "22222222/c.jpg", 7, `${uid}/d.pdf`]),
    [`${uid}/a.jpg`, `${uid}/d.pdf`],
  );
  assert.deepEqual(ownFiles(uid, null), []);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("people: each lifecycle event becomes the right ledger call, and nothing but ids and field names goes through", () => {
  const uid = "11111111-1111-1111-1111-111111111111";
  assert.deepEqual(
    userSyncArgs("taskdrop/user.signed_up", "evt-1", { user_id: uid, name: "Asha" }),
    { p_user: uid, p_event: "signed_up", p_event_id: "evt-1", p_fields: [], p_by_admin: null },
  );
  assert.deepEqual(
    userSyncArgs("taskdrop/user.updated", "evt-2", { user_id: uid.toUpperCase(), changed: ["bio", 7, "skills"] }),
    { p_user: uid, p_event: "updated", p_event_id: "evt-2", p_fields: ["bio", "skills"], p_by_admin: null },
  );
  assert.deepEqual(
    userSyncArgs("taskdrop/user.deleted", undefined, { user_id: uid, by_admin: true }),
    { p_user: uid, p_event: "deleted", p_event_id: null, p_fields: [], p_by_admin: true },
  );
  // the removed-from-auth case sends by_admin: null
  assert.equal(userSyncArgs("taskdrop/user.deleted", "e", { user_id: uid, by_admin: null, removed: true })?.p_by_admin, null);
});

test("people: an event that does not name a person, or is not a user event, is skipped", () => {
  assert.equal(userSyncArgs("taskdrop/user.updated", "e", {}), null);
  assert.equal(userSyncArgs("taskdrop/user.updated", "e", { user_id: "not-a-uuid" }), null);
  assert.equal(userSyncArgs("taskdrop/user.updated", "e", { user_id: 42 }), null);
  assert.equal(userSyncArgs("taskdrop/support.opened", "e", { user_id: "11111111-1111-1111-1111-111111111111" }), null);
  assert.deepEqual(Object.values(USER_EVENTS).sort(), ["deleted", "signed_up", "updated"]);
});

// ----------------------------------------------------------------- pictures --

import { MEDIA_PURGE_BATCH, purgeMediaBatch } from "./jobs.ts";

const IK = { publicKey: "public_t", privateKey: "private_t", urlEndpoint: "https://ik.imagekit.io/demo", env: "local" };

/** A fake database that lists `rows` for the purge and records what was marked, and a fake ImageKit. */
function purgeKit(
  rows: { id: string; provider_file_id: string | null; path: string }[],
  imagekit: (url: string, method: string) => number | { status: number; body: unknown },
) {
  const marked: string[][] = [];
  const asked: string[] = [];
  const rpc: Rpc = async (name, args) => {
    if (name === "media_purge_batch") return { data: rows, error: null };
    if (name === "media_mark_purged") {
      marked.push((args as { p_ids: string[] }).p_ids);
      return { data: (args as { p_ids: string[] }).p_ids.length, error: null };
    }
    return { data: null, error: { message: `unexpected ${name}` } };
  };
  const fetcher = async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    asked.push(`${method} ${url.replace("https://api.imagekit.io/v1", "")}`);
    const r = imagekit(url, method);
    const status = typeof r === "number" ? r : r.status;
    return { ok: status >= 200 && status < 300, status, json: async () => (typeof r === "number" ? null : r.body) };
  };
  return { rpc, fetcher, marked, asked };
}

test("pictures: a deleted picture is removed from ImageKit by its file id and then marked purged", async () => {
  const kit = purgeKit([{ id: "m1", provider_file_id: "f1", path: "/local/u/x/m1.jpg" }], () => 204);
  const r = await purgeMediaBatch(kit.rpc, IK, kit.fetcher);
  assert.deepEqual(kit.asked, ["DELETE /files/f1"]);
  assert.deepEqual(kit.marked, [["m1"]]);
  assert.deepEqual(r, { purged: 1, more: false });
});

test("pictures: one that was never attached is found by its path; if ImageKit has nothing it counts as gone", async () => {
  const rows = [
    { id: "m1", provider_file_id: null, path: "/local/u/x/m1.jpg" },
    { id: "m2", provider_file_id: null, path: "/local/u/x/m2.jpg" },
  ];
  const kit = purgeKit(rows, (url, method) => {
    if (method === "DELETE") return 204;
    return { status: 200, body: url.includes("m1.jpg") ? [{ fileId: "found", filePath: "/local/u/x/m1.jpg" }] : [] };
  });
  const r = await purgeMediaBatch(kit.rpc, IK, kit.fetcher);
  assert.ok(kit.asked.some((a) => a === "DELETE /files/found"));
  assert.equal(kit.asked.filter((a) => a.startsWith("DELETE")).length, 1, "nothing to delete for m2");
  assert.deepEqual(kit.marked, [["m1", "m2"]]);
  assert.equal(r.purged, 2);
});

test("pictures: a failure is retried later, and the pictures that did go are still recorded", async () => {
  const rows = [
    { id: "ok", provider_file_id: "f1", path: "/p1" },
    { id: "bad", provider_file_id: "f2", path: "/p2" },
  ];
  const kit = purgeKit(rows, (url) => (url.endsWith("/files/f2") ? 500 : 204));
  await assert.rejects(purgeMediaBatch(kit.rpc, IK, kit.fetcher), /1 of 2 pictures could not be removed/);
  assert.deepEqual(kit.marked, [["ok"]]);
});

test("pictures: a full batch says there may be more; an empty one does nothing", async () => {
  const many = Array.from({ length: MEDIA_PURGE_BATCH }, (_, i) => ({ id: `m${i}`, provider_file_id: `f${i}`, path: `/p${i}` }));
  const full = purgeKit(many, () => 204);
  assert.equal((await purgeMediaBatch(full.rpc, IK, full.fetcher)).more, true);
  const none = purgeKit([], () => 204);
  assert.deepEqual(await purgeMediaBatch(none.rpc, IK, none.fetcher), { purged: 0, more: false });
  assert.deepEqual(none.marked, []);
});

// ------------------------------------------------------ public snapshots --

function memoryMarker(initial: string | null = null) {
  const m = { value: initial, sets: 0 } as { value: string | null; sets: number } & SnapshotMarker;
  m.get = async () => m.value;
  m.set = async (iso: string) => { m.value = iso; m.sets++; };
  return m;
}
const T0 = new Date("2026-11-04T12:00:00Z");
const minutesAgo = (n: number) => new Date(T0.getTime() - n * 60_000).toISOString();

test("public snapshots: a finished refresh is recorded and reports the time taken", async () => {
  const calls: string[] = [];
  const rpc: Rpc = async (name) => { calls.push(name); return { data: { skipped: false, took_ms: { highlights: 3 } }, error: null }; };
  const marker = memoryMarker();
  const r = await refreshPublicSnapshots(rpc, marker, () => T0);
  assert.deepEqual(calls, ["refresh_public_snapshots"]);
  assert.equal(r.skipped, false);
  assert.deepEqual(r.took_ms, { highlights: 3 });
  assert.equal(marker.value, T0.toISOString());
});

test("public snapshots: another refresh already running is a success and records nothing", async () => {
  const rpc: Rpc = async () => ({ data: { skipped: true }, error: null });
  const marker = memoryMarker(minutesAgo(5));
  const r = await refreshPublicSnapshots(rpc, marker, () => T0);
  assert.deepEqual(r, { skipped: true });
  assert.equal(marker.sets, 0);
});

test("public snapshots: a database error throws so Inngest retries and reports it", async () => {
  const rpc: Rpc = async () => ({ data: null, error: { message: "boom" } });
  const marker = memoryMarker();
  await assert.rejects(refreshPublicSnapshots(rpc, marker, () => T0), /refresh_public_snapshots: boom/);
  assert.equal(marker.sets, 0);
  const odd: Rpc = async () => ({ data: null, error: null });
  await assert.rejects(refreshPublicSnapshots(odd, marker, () => T0), /unexpected answer/);
});

test("public snapshots: stale copy reports to Sentry and leaves one team alert; fresh, unknown and old-alert cases stay quiet", async () => {
  const saved: Array<Record<string, unknown>> = [];
  const rpc: Rpc = async (name, args) => { if (name === "record_admin_alert") saved.push(args ?? {}); return { data: "alert-id", error: null }; };
  const reports: string[] = [];
  const report = async (m: string) => { reports.push(m); };

  assert.deepEqual(await checkSnapshotFreshness(rpc, memoryMarker(minutesAgo(10)), report, () => T0), { ageMinutes: 10, stale: false });
  assert.deepEqual(await checkSnapshotFreshness(rpc, memoryMarker(null), report, () => T0), { ageMinutes: null, stale: false });
  assert.deepEqual(await checkSnapshotFreshness(rpc, memoryMarker("not a time"), report, () => T0), { ageMinutes: null, stale: false });
  assert.equal(reports.length + saved.length, 0);

  const r = await checkSnapshotFreshness(rpc, memoryMarker(minutesAgo(35)), report, () => T0);
  assert.equal(r.stale, true);
  assert.equal(reports.length, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].p_kind, "public_snapshots_stale");

  // Much older: still reported to Sentry every run, but the team alert is not repeated.
  await checkSnapshotFreshness(rpc, memoryMarker(minutesAgo(120)), report, () => T0);
  assert.equal(reports.length, 2);
  assert.equal(saved.length, 1);
});

// ------------------------------------------------- stray ImageKit files --

import { ORPHAN_MAX_DELETES, ORPHAN_PAGE, runStraySweep, sweepStrayImageKitFiles, type KnownFiles } from "./jobs.ts";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
type IkFile = { fileId: string; filePath: string; createdAt: string };
const ikFile = (n: number, ageDays: number, folder = "local"): IkFile => ({ fileId: `f${n}`, filePath: `/${folder}/u/x/${n}.jpg`, createdAt: daysAgo(ageDays) });

/** A fake ImageKit holding `files` (oldest first), recording every request. */
function strayKit(files: IkFile[], deleteStatus = 204) {
  const asked: string[] = [];
  const fetcher = async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    asked.push(`${method} ${url.replace("https://api.imagekit.io/v1", "")}`);
    if (method === "DELETE") return { ok: deleteStatus < 300, status: deleteStatus, json: async () => null };
    const q = new URL(url).searchParams;
    const skip = Number(q.get("skip"));
    const limit = Number(q.get("limit"));
    return { ok: true, status: 200, json: async () => files.slice(skip, skip + limit) };
  };
  const deletes = () => asked.filter((a) => a.startsWith("DELETE")).map((a) => a.replace("DELETE /files/", ""));
  return { fetcher, asked, deletes };
}
const knowing = (paths: string[] = [], fileIds: string[] = []): KnownFiles => async () => ({ paths: new Set(paths), fileIds: new Set(fileIds) });

test("stray files: an old file with no media row is removed; one with a row (by path or by id), a young one and another folder are not", async () => {
  const files = [
    ikFile(1, 10), // stray
    ikFile(2, 10), // known by path
    ikFile(3, 10), // known by file id
    ikFile(4, 10, "prod"), // another deployment's folder
    ikFile(5, 1), // too young
    { fileId: "f6", filePath: "/local/u/x/6.jpg", createdAt: "not a date" }, // age unknown
  ];
  const kit = strayKit(files);
  const r = await sweepStrayImageKitFiles(IK, kit.fetcher, knowing([files[1].filePath], ["f3"]), { now: NOW });
  assert.deepEqual(kit.deletes(), ["f1"]);
  assert.deepEqual(r, { scanned: 6, strays: 1, deleted: 1, failed: 0, dryRun: false });
});

test("stray files: exactly two days old counts as old, a minute younger does not", async () => {
  const edge: IkFile = { fileId: "e1", filePath: "/local/u/x/e1.jpg", createdAt: daysAgo(2) };
  const young: IkFile = { fileId: "e2", filePath: "/local/u/x/e2.jpg", createdAt: new Date(NOW.getTime() - 2 * 86_400_000 + 60_000).toISOString() };
  const kit = strayKit([edge, young]);
  await sweepStrayImageKitFiles(IK, kit.fetcher, knowing(), { now: NOW });
  assert.deepEqual(kit.deletes(), ["e1"]);
});

test("stray files: a dry run counts the strays and deletes nothing", async () => {
  const kit = strayKit([ikFile(1, 10), ikFile(2, 10)]);
  const r = await sweepStrayImageKitFiles(IK, kit.fetcher, knowing(), { now: NOW, dryRun: true });
  assert.deepEqual(r, { scanned: 2, strays: 2, deleted: 0, failed: 0, dryRun: true });
  assert.equal(kit.deletes().length, 0);
});

test("stray files: at most 200 are removed in one run, whatever is asked", async () => {
  assert.equal(ORPHAN_MAX_DELETES, 200);
  const files = Array.from({ length: 450 }, (_, i) => ikFile(i, 10));
  const kit = strayKit(files);
  const r = await sweepStrayImageKitFiles(IK, kit.fetcher, knowing(), { now: NOW, maxDeletes: 5000 });
  assert.equal(kit.deletes().length, 200);
  assert.equal(r.deleted, 200);
  assert.equal(r.strays, 200);
  // The cap is a ceiling the caller can only lower.
  const small = strayKit(files);
  await sweepStrayImageKitFiles(IK, small.fetcher, knowing(), { now: NOW, maxDeletes: 7 });
  assert.equal(small.deletes().length, 7);
});

test("stray files: pages are read until a short page or a page that ends in a too-young file", async () => {
  const many = Array.from({ length: ORPHAN_PAGE + 10 }, (_, i) => ikFile(i, 10));
  const kit = strayKit(many);
  const r = await sweepStrayImageKitFiles(IK, kit.fetcher, knowing(many.map((f) => f.filePath)), { now: NOW });
  assert.equal(r.scanned, ORPHAN_PAGE + 10);
  assert.equal(kit.asked.filter((a) => a.startsWith("GET")).length, 2);
  assert.equal(kit.deletes().length, 0);
  // A first page whose last file is too young ends the scan after one request.
  const young = strayKit([ikFile(1, 10), ...Array.from({ length: ORPHAN_PAGE - 1 }, (_, i) => ikFile(i + 2, 0.5))]);
  await sweepStrayImageKitFiles(IK, young.fetcher, knowing(), { now: NOW });
  assert.equal(young.asked.filter((a) => a.startsWith("GET")).length, 1);
});

test("stray files: if the database cannot be asked, or a listing fails, nothing is removed", async () => {
  const kit = strayKit([ikFile(1, 10)]);
  const cannot: KnownFiles = async () => { throw new Error("media lookup: down"); };
  await assert.rejects(sweepStrayImageKitFiles(IK, kit.fetcher, cannot, { now: NOW }), /media lookup/);
  assert.equal(kit.deletes().length, 0);
  const broken = async () => ({ ok: false, status: 500, json: async () => null });
  await assert.rejects(sweepStrayImageKitFiles(IK, broken, knowing(), { now: NOW }), /HTTP 500/);
});

test("stray files: a failed delete is reported so Inngest retries, after the others were tried", async () => {
  const kit = strayKit([ikFile(1, 10), ikFile(2, 10)], 500);
  await assert.rejects(sweepStrayImageKitFiles(IK, kit.fetcher, knowing(), { now: NOW }), /2 of 2 could not be removed/);
  assert.equal(kit.deletes().length, 2);
});

test("stray files: without ImageKit's keys the job does nothing at all", async () => {
  let touched = 0;
  const spy = async () => { touched++; return { ok: true, status: 200, json: async () => [] }; };
  const known: KnownFiles = async () => { touched++; return { paths: new Set(), fileIds: new Set() }; };
  assert.deepEqual(await runStraySweep(null, spy, known, { now: NOW }), { skipped: "ImageKit is not configured" });
  assert.equal(touched, 0);
});

test("stray files: the result carries counts only, never a path or a file name", async () => {
  const kit = strayKit([ikFile(1, 10)]);
  const r = await sweepStrayImageKitFiles(IK, kit.fetcher, knowing(), { now: NOW });
  assert.ok(Object.values(r).every((v) => typeof v === "number" || typeof v === "boolean"));
});
