import type { Fetch, MoneyProvider, MoveInput, MoveResult, PayeeStatus, WebhookEvent } from "./types.ts";
import { callJson, esc, hmacHex, num, payeeHint, refusalNote, safeEqual, sha256Hex, str } from "./util.ts";

/**
 * Razorpay Route adapter (decision 3, decided 19 Nov 2026: Razorpay is the Plan B payment company). Written from razorpay.com/docs on 18 Nov 2026 and NOT yet
 * run against a test account: see docs/integrations/razorpay-route.md, whose "NOT CONFIRMED" points are
 * marked again here. Route needs ₹40 lakh turnover today, which may rule it out (S.4).
 *
 *   payee        POST /v2/accounts (composite, business_type=individual), GET /v2/accounts/:id
 *   payment      POST /v1/orders with transfers[{account, amount, on_hold:true}], paid on Razorpay's
 *                hosted checkout (POST form to /v1/checkout/embedded; must be enabled on the account,
 *                NOT CONFIRMED)
 *   release      PATCH /v1/transfers/:id {on_hold:false}
 *   refund       POST /v1/payments/:id/refund (reverse_all for a full refund; a split first reverses
 *                the refunded part of the transfer, POST /v1/transfers/:id/reversals)
 *   webhooks     X-Razorpay-Signature = hex HMAC-SHA256(raw body), x-razorpay-event-id to dedupe
 *
 * Razorpay documents no idempotency header for refunds or reversals (NOT CONFIRMED), so each one carries
 * our move key in `receipt`/`notes.key`, and we look for an earlier one with that key before sending.
 */

const BASE = "https://api.razorpay.com";

export type RazorpayConfig = { keyId: string; keySecret: string; webhookSecret: string };

function statusOf(s: unknown): PayeeStatus {
  switch (s) {
    case "activated":
      return "active";
    case "suspended":
      return "suspended";
    case "rejected":
      return "rejected";
    default:
      return "pending"; // created, under_review, needs_clarification, not_activated (list NOT CONFIRMED)
  }
}

function items(body: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
}

const keyOf = (row: Record<string, unknown>): string | null =>
  str((row.notes as Record<string, unknown> | undefined)?.key) ?? str(row.receipt);

export function razorpayRouteProvider(cfg: RazorpayConfig, f: Fetch = fetch): MoneyProvider {
  const auth = { Authorization: `Basic ${btoa(`${cfg.keyId}:${cfg.keySecret}`)}` };
  const get = (path: string) => callJson(f, BASE + path, { method: "GET", headers: auth });
  const send = (method: string, path: string, body: unknown, extra: Record<string, string> = {}) =>
    callJson(f, BASE + path, { method, headers: { ...auth, ...extra }, body });

  /** The transfer made with the order, found through the payment when we were not told it. */
  async function transferFor(move: MoveInput): Promise<string | null> {
    if (move.transferId) return move.transferId;
    if (!move.paymentId) return null;
    const a = await get(`/v1/payments/${encodeURIComponent(move.paymentId)}/transfers`);
    return str(items(a.body)[0]?.id);
  }

  return {
    name: "razorpay_route",

    async setupPayee(input) {
      const settlement = input.method === "upi"
        ? { upi: { vpa: input.upi }, is_default: true }
        : { bank_account: { account_number: input.accountNumber, ifsc_code: input.ifsc, beneficiary_name: input.name }, is_default: true };
      const a = await send("POST", "/v2/accounts", {
        type: "route",
        reference_id: input.userId.replace(/-/g, "").slice(0, 20),
        legal_business_name: input.name,
        contact_name: input.name,
        business_type: "individual",
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        tnc_accepted: true,
        stakeholder: { name: input.name, kyc: { pan: input.pan } },
        settlement_accounts: [settlement],
      }, { "Idempotency-Key": `payee:${input.userId}` });
      if (a.status >= 400) throw new Error(refusalNote(a));
      const id = str(a.body.id);
      if (!id) throw new Error("Razorpay did not return an account id");
      return { accountId: id, status: statusOf(a.body.status), hint: payeeHint(input.method, input.upi, input.accountNumber) };
    },

    async payeeStatus(accountId) {
      const a = await get(`/v2/accounts/${encodeURIComponent(accountId)}`);
      if (a.status >= 400) throw new Error(refusalNote(a));
      return { status: statusOf(a.body.status) };
    },

    async startPayment(input) {
      const a = await send("POST", "/v1/orders", {
        amount: input.chargedMinor,
        currency: "INR",
        receipt: input.holdId.slice(0, 40),
        notes: { hold_id: input.holdId, task_id: input.taskId },
        transfers: [{
          account: input.payeeAccountId,
          amount: input.workerShareMinor,
          currency: "INR",
          on_hold: true,
          notes: { hold_id: input.holdId },
        }],
      });
      if (a.status >= 400) throw new Error(refusalNote(a));
      const id = str(a.body.id);
      if (!id) throw new Error("Razorpay did not return an order id");
      return { orderId: id, ref: "rzp_hosted" };
    },

    checkoutPage(_ref, ctx) {
      const fields: Record<string, string> = {
        key_id: cfg.keyId, // the public key id, safe in a page
        order_id: ctx.orderId,
        amount: String(ctx.chargedMinor),
        currency: "INR",
        name: "TaskDrop",
        description: ctx.title.slice(0, 60),
        "notes[hold_order]": ctx.orderId,
        ...(ctx.returnUrl ? { callback_url: ctx.returnUrl, cancel_url: ctx.returnUrl } : {}),
      };
      const inputs = Object.entries(fields)
        .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
      return {
        html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>Pay for your task</title></head><body style="font-family:sans-serif;padding:24px">` +
          `<p>Opening Razorpay…</p><form id="f" method="POST" action="${BASE}/v1/checkout/embedded">${inputs}` +
          `<button type="submit">Continue to pay</button></form><script>document.getElementById("f").submit()</script></body></html>`,
      };
    },

    async readPayment(orderId) {
      const o = await get(`/v1/orders/${encodeURIComponent(orderId)}/payments`);
      if (o.status >= 400) throw new Error(refusalNote(o));
      const paid = items(o.body).find((p) => p.status === "captured");
      if (!paid) return { paid: false };
      const paymentId = str(paid.id);
      let transferId: string | null = null;
      if (paymentId) {
        const t = await get(`/v1/payments/${encodeURIComponent(paymentId)}/transfers`);
        transferId = str(items(t.body)[0]?.id);
      }
      return { paid: true, paymentId, transferId, amountMinor: num(paid.amount) };
    },

    async release(move): Promise<MoveResult> {
      const transfer = await transferFor(move);
      if (!transfer) return { ok: false, note: "No transfer found for this payment" };
      const a = await send("PATCH", `/v1/transfers/${encodeURIComponent(transfer)}`, { on_hold: false });
      if (a.status < 400 || a.body.on_hold === false) return { ok: true, ref: transfer };
      return { ok: false, note: refusalNote(a) };
    },

    async refund(move): Promise<MoveResult> {
      if (!move.paymentId) return { ok: false, note: "No payment to refund" };
      const pay = encodeURIComponent(move.paymentId);

      // Already sent with this key? Then it is the same refund (a retry after an unknown outcome).
      const earlier = await get(`/v1/payments/${pay}/refunds`);
      const same = items(earlier.body).find((r) => keyOf(r) === move.key);
      if (same && str(same.id)) return { ok: true, ref: str(same.id)! };

      const full = move.status !== "split_asked";
      if (!full) {
        // A split: only what the worker does not keep comes off the transfer. A fine split keeps
        // charged - refund; a dispute split (migration 255) keeps release_minor, which is less (TaskDrop's
        // commission on the part done stays with TaskDrop). An older claim without release_minor is a fine.
        const keep = move.releaseMinor != null && move.releaseMinor >= 0
          ? Math.min(move.releaseMinor, move.chargedMinor - move.amountMinor)
          : move.chargedMinor - move.amountMinor;
        const reverse = Math.max(move.workerShareMinor - keep, 0);
        const transfer = await transferFor(move);
        if (reverse > 0 && transfer) {
          const t = encodeURIComponent(transfer);
          const rev = await get(`/v1/transfers/${t}/reversals`);
          if (!items(rev.body).some((r) => keyOf(r) === `${move.key}:reverse`)) {
            const r = await send("POST", `/v1/transfers/${t}/reversals`, { amount: reverse, notes: { key: `${move.key}:reverse` } });
            if (r.status >= 400) return { ok: false, note: refusalNote(r) };
          }
        }
      }
      const a = await send("POST", `/v1/payments/${pay}/refund`, {
        amount: move.amountMinor,
        speed: "normal",
        receipt: move.key.slice(0, 40),
        notes: { key: move.key },
        ...(full ? { reverse_all: true } : {}),
      });
      if (a.status >= 400) return { ok: false, note: refusalNote(a) };
      return { ok: true, ref: str(a.body.id) ?? move.key };
    },

    async settlementTotal(day) {
      // Payments captured that India day for a Plan B hold (the checkout page tags each with notes.hold_order).
      const from = Math.floor(new Date(`${day}T00:00:00+05:30`).getTime() / 1000);
      const to = from + 86_400 - 1;
      let total = 0;
      let rows = 0;
      for (let skip = 0; skip < 5_000; skip += 100) {
        const a = await get(`/v1/payments?from=${from}&to=${to}&count=100&skip=${skip}`);
        if (a.status >= 400) throw new Error(refusalNote(a));
        const page = items(a.body);
        for (const p of page) {
          if (p.status !== "captured" && p.status !== "refunded") continue;
          if (!str((p.notes as Record<string, unknown> | undefined)?.hold_order)) continue;
          total += num(p.amount) ?? 0;
          rows += 1;
        }
        if (page.length < 100) break;
      }
      return { totalMinor: total, rows };
    },

    async verifyWebhook(raw, headers): Promise<WebhookEvent | null> {
      const sent = headers.get("x-razorpay-signature") ?? "";
      if (!sent || !cfg.webhookSecret || !safeEqual(sent, await hmacHex(cfg.webhookSecret, raw))) return null;
      let e: { event?: string; payload?: Record<string, { entity?: Record<string, unknown> }> };
      try {
        e = JSON.parse(raw);
      } catch {
        return null;
      }
      const id = headers.get("x-razorpay-event-id") ?? `sha:${(await sha256Hex(raw)).slice(0, 40)}`;
      const payment = e.payload?.payment?.entity ?? {};
      const kind = e.event ?? "";
      if (kind === "payment.captured" || kind === "order.paid") {
        return {
          id, raw: kind, kind: "payment.paid",
          orderId: str(payment.order_id) ?? str(e.payload?.order?.entity?.id),
          paymentId: str(payment.id),
          amountMinor: num(payment.amount),
        };
      }
      if (kind.startsWith("account.") || kind.startsWith("product.route.")) {
        const acc = e.payload?.account?.entity ?? {};
        const product = e.payload?.merchant_product?.entity ?? {};
        const accountId = str(acc.id) ?? str(product.account_id);
        const state = kind.split(".").pop();
        return { id, raw: kind, kind: "payee.status", accountId, payeeStatus: statusOf(state === "activated" ? "activated" : state) };
      }
      if (kind === "transfer.failed" || kind === "refund.failed") {
        const ent = e.payload?.transfer?.entity ?? e.payload?.refund?.entity ?? {};
        return { id, raw: kind, kind: "move.failed", paymentId: str(ent.payment_id) ?? str(ent.source), note: kind };
      }
      return { id, raw: kind, kind: "other" };
    },
  };
}
