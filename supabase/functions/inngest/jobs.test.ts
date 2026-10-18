/**
 * Tests for the Inngest jobs' logic, against a fake database.
 *
 * Run from the repo root with Node 22+ (also part of `npm test`):
 *   node --experimental-strip-types --no-warnings --test supabase/functions/inngest/jobs.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALERT_EVENTS, alertFor, call, chunk, compareProviderPayment, deadKeys, digestAlert, expoReceipts, expoSend, ownFiles,
  readTickets, safeData, saveAlert, toEvents, tokenKey, tokensForKeys, userSyncArgs, USER_EVENTS, type Fetch, type Rpc,
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
