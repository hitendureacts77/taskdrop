/**
 * Tests for the Inngest jobs' logic, against a fake database.
 *
 * Run from the repo root with Node 22+ (also part of `npm test`):
 *   node --experimental-strip-types --no-warnings --test supabase/functions/inngest/jobs.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ALERT_EVENTS, alertFor, call, compareProviderPayment, digestAlert, safeData, saveAlert, toEvents, type Rpc } from "./jobs.ts";

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
