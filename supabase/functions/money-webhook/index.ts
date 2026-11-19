import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { guarded, captureSecurityEvent, captureServerError, logServer } from "../_shared/monitoring.ts";
import { secret } from "../_shared/secrets.ts";
import { readEnvironment } from "../_shared/keyGuard.ts";
import { makeProvider, runMoves } from "../_shared/money/index.ts";

/**
 * Razorpay Route webhook for Plan B (task 2.21, migration 193).
 *
 * Public (verify_jwt = false): Razorpay has no Supabase session. What makes it safe is the signature,
 * checked on the exact bytes before anything is read or written. Every action here is safe to repeat
 * (plan_b_mark_paid and the payee update do nothing the second time), so a redelivered message cannot pay
 * or fund twice; each message id is also kept once in money_webhook_events.
 *
 *   payment.captured / order.paid   the poster's payment arrived: hold it and fund the task
 *   account.* / product.route.*     a worker's linked account changed (activated, under review, ...)
 *   transfer.failed / refund.failed a money move failed after Razorpay accepted it: tell the team
 *
 * Needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET. Point a Razorpay webhook at
 *   https://<project>.supabase.co/functions/v1/money-webhook
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(guarded("money-webhook", async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const [keyId, keySecret, webhookSecret] = await Promise.all([
    secret("RAZORPAY_KEY_ID"), secret("RAZORPAY_KEY_SECRET"), secret("RAZORPAY_WEBHOOK_SECRET"),
  ]);
  if (!keyId || !keySecret || !webhookSecret) {
    await logServer("error", "money-webhook", "Razorpay secrets are not configured");
    return json({ error: "Webhook is not configured", configured: false }, 503);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const environment = await readEnvironment(admin, "money-webhook");
  const provider = makeProvider("razorpay_route", { environment, razorpay: { keyId, keySecret, webhookSecret } });

  const raw = await req.text();
  const event = await provider.verifyWebhook(raw, req.headers);
  if (!event) {
    await logServer("warn", "money-webhook", "bad signature", { signed: Boolean(req.headers.get("x-razorpay-signature")) });
    await captureSecurityEvent("bad_signature", "money-webhook");
    return json({ error: "Bad signature" }, 401);
  }

  if (event.kind === "payment.paid" && event.orderId) {
    const { data: res, error } = await admin.rpc("plan_b_mark_paid", {
      p_order_id: event.orderId, p_payment_id: event.paymentId ?? null,
      p_transfer_id: event.transferId ?? null, p_amount_minor: event.amountMinor ?? null,
    });
    if (error) {
      // Answer 500 so Razorpay sends it again; marking paid is safe to repeat.
      await logServer("error", "money-webhook", "could not record the payment", { error: error.message });
      await captureServerError(error, { fn: "money-webhook", step: "mark_paid" });
      return json({ error: "Try again" }, 500);
    }
    if (res === "amount_mismatch") {
      await logServer("error", "money-webhook", "paid amount differs from the hold, kept for staff", { event: event.raw });
      await captureSecurityEvent("amount_mismatch", "money-webhook");
    }
    if (res === "refund") {
      const { data: h } = await admin.from("task_holds").select("id").eq("provider_order_id", event.orderId).maybeSingle();
      if (h?.id) await runMoves(admin, provider, h.id).catch((e) => captureServerError(e, { fn: "money-webhook", step: "late_refund" }));
    }
    // "unknown" is an order that is not a Plan B hold (another flow's payment): nothing to do here.
    await logServer("info", "money-webhook", "payment message", { event: event.raw, result: String(res) });
  } else if (event.kind === "payee.status" && event.accountId && event.payeeStatus) {
    const { error } = await admin.rpc("plan_b_payee_status", {
      p_provider: "razorpay_route", p_account_id: event.accountId, p_status: event.payeeStatus, p_note: null,
    });
    if (error) {
      await captureServerError(error, { fn: "money-webhook", step: "payee_status" });
      return json({ error: "Try again" }, 500);
    }
  } else if (event.kind === "move.failed") {
    await logServer("error", "money-webhook", "a money move failed at Razorpay", { event: event.raw });
    await captureServerError(new Error(`Razorpay reported ${event.raw}`), { fn: "money-webhook", step: "move_failed" });
    await admin.rpc("record_admin_alert", {
      p_kind: "money_move_failed",
      p_title: "A Razorpay money move failed",
      p_body: `Razorpay reported ${event.raw}. Open Money, then the holds list, to check and retry.`,
      p_data: { event: event.raw },
    });
  }

  await admin.rpc("plan_b_first_webhook", { p_provider: "razorpay_route", p_event_id: event.id, p_kind: event.raw });
  return json({ ok: true });
}));
