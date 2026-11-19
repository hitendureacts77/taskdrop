import test from "node:test";
import assert from "node:assert/strict";
import { makeProvider, moveFrom, readPayee, runMove, runMoves, type Rpc, UnknownOutcome } from "./index.ts";
import { razorpayRouteProvider } from "./razorpayRoute.ts";
import { hmacHex, payeeHint } from "./util.ts";

const STAGING = { environment: "staging" as const, supabaseUrl: "http://localhost:54321" };
const USER = "11111111-2222-3333-4444-555555555555";

test("makeProvider: the simulated provider never runs outside staging", () => {
  assert.equal(makeProvider("simulated", STAGING).name, "simulated");
  assert.throws(() => makeProvider("simulated", { environment: "production", supabaseUrl: "http://localhost:54321" }), /only runs on staging/);
  assert.throws(() => makeProvider("simulated", { environment: "staging", supabaseUrl: "https://someprod.supabase.co" }), /only runs on staging/, "a production project address refuses it even if the setting says staging");
  assert.throws(() => makeProvider("simulated", { environment: "staging" }), /only runs on staging/);
  assert.throws(() => makeProvider("razorpay_route", STAGING), /not configured/);
  assert.throws(() => makeProvider("cashfree_split", STAGING), /Unknown payment provider/);
});

test("readPayee: checks every field and keeps only what was asked for", () => {
  const upi = readPayee(USER, { name: " Asha  Rao ", pan: "abcpe1234f", method: "upi", upi: "Asha@okhdfc" });
  assert.deepEqual(upi, { userId: USER, name: "Asha Rao", pan: "ABCPE1234F", method: "upi", upi: "asha@okhdfc" });
  const bank = readPayee(USER, { name: "Ravi Kumar", pan: "ABCPK1234F", method: "bank", accountNumber: "1234 5678 9012", ifsc: "hdfc0001234" });
  assert.deepEqual(bank, { userId: USER, name: "Ravi Kumar", pan: "ABCPK1234F", method: "bank", accountNumber: "123456789012", ifsc: "HDFC0001234" });
  assert.ok("error" in readPayee(USER, { name: "Asha Rao", pan: "ABCCE1234F", method: "upi", upi: "a@okhdfc" }), "a company PAN (4th letter not P) is refused");
  assert.ok("error" in readPayee(USER, { name: "Asha Rao", pan: "ABCPE1234F", method: "upi", upi: "not-an-id" }));
  assert.ok("error" in readPayee(USER, { name: "Asha Rao", pan: "ABCPE1234F", method: "bank", accountNumber: "12", ifsc: "HDFC0001234" }));
  assert.ok("error" in readPayee(USER, { name: "Asha Rao", pan: "ABCPE1234F", method: "bank", accountNumber: "123456789", ifsc: "HDFC1001234" }));
  assert.ok("error" in readPayee(USER, { name: "Al", pan: "ABCPE1234F", method: "upi", upi: "a@okhdfc" }));
});

test("payeeHint: never the whole number", () => {
  assert.equal(payeeHint("upi", "asha@okhdfc"), "UPI ••••@okhdfc");
  assert.equal(payeeHint("bank", undefined, "123456789012"), "Bank ••9012");
});

test("razorpay webhook: a good signature is read, a bad or missing one is refused", async () => {
  const p = razorpayRouteProvider({ keyId: "rzp_test_x", keySecret: "s", webhookSecret: "whsec" }, (() => { throw new Error("no calls"); }) as typeof fetch);
  const raw = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 103000, status: "captured" } } },
  });
  const good = new Headers({ "x-razorpay-signature": await hmacHex("whsec", raw), "x-razorpay-event-id": "evt_1" });
  const e = await p.verifyWebhook(raw, good);
  assert.deepEqual(
    { id: e?.id, kind: e?.kind, orderId: e?.orderId, paymentId: e?.paymentId, amountMinor: e?.amountMinor },
    { id: "evt_1", kind: "payment.paid", orderId: "order_1", paymentId: "pay_1", amountMinor: 103000 },
  );
  assert.equal(await p.verifyWebhook(raw, new Headers({ "x-razorpay-signature": "00" })), null);
  assert.equal(await p.verifyWebhook(raw + " ", good), null, "the signature covers the exact bytes");
  assert.equal(await p.verifyWebhook(raw, new Headers()), null);

  const acc = JSON.stringify({ event: "account.activated", payload: { account: { entity: { id: "acc_9" } } } });
  const a = await p.verifyWebhook(acc, new Headers({ "x-razorpay-signature": await hmacHex("whsec", acc) }));
  assert.equal(a?.kind, "payee.status");
  assert.equal(a?.accountId, "acc_9");
  assert.equal(a?.payeeStatus, "active");
});

test("razorpay checkout page: the public key id and order only, escaped", () => {
  const p = razorpayRouteProvider({ keyId: "rzp_test_pub", keySecret: "never-in-a-page", webhookSecret: "w" });
  const page = p.checkoutPage("rzp_hosted", { orderId: "order_9", chargedMinor: 103000, title: "Fix <tap>", returnUrl: "https://taskdrop.in/pay" });
  assert.ok(page.html?.includes("rzp_test_pub") && page.html.includes("order_9"));
  assert.ok(!page.html?.includes("never-in-a-page"), "the secret key never reaches a page");
  assert.ok(page.html?.includes("Fix &lt;tap&gt;") && !page.html.includes("<tap>"));
});

/** A fake database for the move runner: answers claim and record like migration 193. */
function fakeDb(claims: unknown[]) {
  const recorded: Record<string, unknown>[] = [];
  const db: Rpc = {
    rpc(name, args) {
      if (name === "plan_b_claim_move") return Promise.resolve({ data: claims.shift() ?? null, error: null });
      if (name === "plan_b_record_move") {
        recorded.push(args ?? {});
        return Promise.resolve({ data: args?.p_ok ? "released" : "failed", error: null });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected " + name } });
    },
  };
  return { db, recorded };
}

const claim = (part: string, status = "release_asked") => ({
  hold_id: "h1", part, status, amount_minor: 90000, charged_minor: 103000, worker_share_minor: 90000,
  key: `${part}:h1`, provider_order_id: "o", provider_payment_id: "p", provider_transfer_id: "t", payee_account_id: "acc",
});

test("runMove: nothing claimed, nothing sent", async () => {
  const { db, recorded } = fakeDb([]);
  const o = await runMove(db, makeProvider("simulated", STAGING), "h1");
  assert.equal(o.done, "nothing");
  assert.equal(recorded.length, 0);
});

test("runMove: a sent move is recorded with the provider reference and its own key", async () => {
  const { db, recorded } = fakeDb([claim("release")]);
  const o = await runMove(db, makeProvider("simulated", STAGING), "h1");
  assert.equal(o.done, "sent");
  assert.deepEqual(recorded[0], { p_hold_id: "h1", p_part: "release", p_ok: true, p_ref: "sim_release:h1", p_note: null });
});

test("runMove: an unknown outcome records nothing, so the same key is retried later", async () => {
  const { db, recorded } = fakeDb([claim("refund", "refund_asked")]);
  const flaky = { ...makeProvider("simulated", STAGING), refund: () => Promise.reject(new UnknownOutcome("timeout")) };
  const o = await runMove(db, flaky, "h1");
  assert.equal(o.done, "unknown");
  assert.equal(recorded.length, 0);
});

test("runMove: a refusal is recorded as failed for staff", async () => {
  const { db, recorded } = fakeDb([claim("release")]);
  const no = { ...makeProvider("simulated", STAGING), release: () => Promise.resolve({ ok: false as const, note: "account suspended" }) };
  const o = await runMove(db, no, "h1");
  assert.equal(o.done, "refused");
  assert.equal(recorded[0].p_ok, false);
  assert.equal(recorded[0].p_note, "account suspended");
});

test("runMoves: a split sends both halves, then stops", async () => {
  const { db, recorded } = fakeDb([claim("refund", "split_asked"), claim("release", "split_asked")]);
  const out = await runMoves(db, makeProvider("simulated", STAGING), "h1");
  assert.deepEqual(out.map((o) => o.done), ["sent", "sent", "nothing"]);
  assert.deepEqual(recorded.map((r) => r.p_part), ["refund", "release"]);
});

test("moveFrom: a malformed claim is nothing to do", () => {
  assert.equal(moveFrom(null), null);
  assert.equal(moveFrom({ hold_id: "h", part: "steal", key: "k" }), null);
  assert.equal(moveFrom({ part: "release", key: "k" }), null);
});
