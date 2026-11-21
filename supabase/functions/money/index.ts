import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.116.0";
import { secret } from "../_shared/secrets.ts";
import { guardKey, readEnvironment } from "../_shared/keyGuard.ts";
import { TOO_FAST, withinRate } from "../_shared/rateLimit.ts";
import { safeReturnUrl } from "../_shared/returnUrl.ts";
import { STANDING_REFUSAL, mustRefuse, standingOf } from "../_shared/standing.ts";
import { guarded, captureSecurityEvent, captureServerError, logServer } from "../_shared/monitoring.ts";
import { PLATFORM_HEADER, VERSION_HEADER } from "../_shared/controls.ts";
import { type Environment, makeProvider, type MoneyProvider, readPayee, runMoves, UnknownOutcome } from "../_shared/money/index.ts";

/**
 * Plan B money for signed-in people (task 2.21, migration 195). Pay per task: Razorpay Route holds each
 * task's money until the poster approves; TaskDrop never holds a balance. Design:
 * docs/design/plan-b-money/DESIGN.md.
 *
 *   checkout       the poster's payment page for a hired task (one Razorpay Order per hire, re-used)
 *   sync           ask the provider whether that payment arrived (the webhook usually got there first);
 *                  on staging with the simulated provider, `simulate: true` is the test payment itself
 *   payout-setup   a worker's "Get paid": name, PAN and UPI or bank go straight to Razorpay, never stored
 *   payout-status  re-read a pending payee account
 *   settle         run a task's waiting release or refund now, so people see it happen (Inngest retries)
 *
 * Postgres decides every amount and state; this function only carries out outside calls. The money stop
 * (admin) is enforced in the database: checkout is refused and releases are not claimed while it is on.
 *
 * Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (shared with the razorpay function). None for simulated.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region, " + PLATFORM_HEADER + ", " + VERSION_HEADER,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Body = {
  action?: string;
  taskId?: string;
  returnUrl?: string;
  simulate?: boolean;
  name?: string;
  pan?: string;
  method?: string;
  upi?: string;
  accountNumber?: string;
  ifsc?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A database refusal is already plain words for people (the functions raise them that way). */
const plain = (m: string | undefined) => (m ?? "Something went wrong").replace(/^.*?ERROR:\s*/, "").slice(0, 200);

async function providerFor(admin: SupabaseClient, name: string, environment: Environment): Promise<MoneyProvider | Response> {
  if (name === "razorpay_route") {
    const keyId = await secret("RAZORPAY_KEY_ID");
    const keySecret = await secret("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) {
      await logServer("error", "money", "Razorpay keys are not configured");
      return json({ error: "Payments are not set up yet. Nothing was charged.", configured: false }, 503);
    }
    // A live key on staging (or a test key in production) stops everything before Razorpay is called.
    const wrongKey = await guardKey(admin, "money", keyId);
    if (wrongKey) return json(wrongKey.body, wrongKey.status);
    return makeProvider(name, { environment, razorpay: { keyId, keySecret, webhookSecret: "" } });
  }
  try {
    return makeProvider(name, { environment, supabaseUrl: Deno.env.get("SUPABASE_URL") });
  } catch (e) {
    await logServer("error", "money", "provider refused to start", { provider: name, error: e instanceof Error ? e.message : String(e) });
    return json({ error: "Payments are not available right now. Nothing was charged." }, 503);
  }
}

Deno.serve(guarded("money", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "Sign in first" }, 401);
  const user = userData.user;
  const userId = user.id;

  const standing = await standingOf(admin, userId);
  if (mustRefuse(standing)) {
    await logServer("warn", "money", "refused: " + standing + " account", { user_id: userId });
    return json({ error: STANDING_REFUSAL, code: "UNAUTHENTICATED" }, 401);
  }

  if (!(await withinRate(admin, userId, "payments", 30, (m) => void logServer("warn", "money", "rate limiter unavailable", { error: m })))) {
    return json({ error: TOO_FAST, code: "RATE_LIMITED" }, 429);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  const { data: cfgData, error: cfgErr } = await admin.rpc("plan_b_config");
  if (cfgErr) return json({ error: "Payments are not available right now." }, 503);
  const cfg = cfgData as { flow: string; provider: string; paused: boolean };
  const environment = await readEnvironment(admin, "money");

  // ---- Get paid ----------------------------------------------------------------------------
  if (body.action === "payout-setup") {
    // Typing bank details again and again is not a normal flow: 5 a minute is plenty.
    if (!(await withinRate(admin, userId, "payee", 5))) return json({ error: TOO_FAST, code: "RATE_LIMITED" }, 429);
    const input = readPayee(userId, body as Record<string, unknown>);
    if ("error" in input) return json({ error: input.error, code: "INVALID" }, 400);
    input.email = user.email ?? null;
    input.phone = user.phone ? `+${user.phone.replace(/^\+/, "")}` : null;

    const provider = await providerFor(admin, cfg.provider, environment);
    if (provider instanceof Response) return provider;
    let result;
    try {
      result = await provider.setupPayee(input);
    } catch (e) {
      // Only the provider's refusal text goes back; never the details that were typed.
      const unknown = e instanceof UnknownOutcome;
      await logServer(unknown ? "error" : "warn", "money", "payee setup failed", { user_id: userId, provider: provider.name, unknown });
      if (unknown) await captureServerError(e, { fn: "money", step: "payout-setup" });
      return json({ error: unknown ? "The payment company did not answer. Please try again." : `The payment company said: ${e instanceof Error ? e.message : "no"}` }, unknown ? 502 : 400);
    }
    const { error } = await admin.rpc("plan_b_save_payee", {
      p_user: userId, p_provider: provider.name, p_account_id: result.accountId,
      p_status: result.status, p_method: input.method, p_hint: result.hint, p_note: result.note ?? null,
    });
    if (error) {
      await captureServerError(error, { fn: "money", step: "save_payee" });
      return json({ error: "Saved at the payment company, but not here yet. Please try again." }, 500);
    }
    await logServer("info", "money", "payee account saved", { user_id: userId, provider: provider.name, status: result.status });
    return json({ ok: true, status: result.status, hint: result.hint });
  }

  if (body.action === "payout-status") {
    const { data: acc } = await admin.from("payout_accounts").select("provider, provider_account_id, status, method_hint")
      .eq("user_id", userId).maybeSingle();
    if (!acc) return json({ status: null });
    if (acc.status !== "pending") return json({ status: acc.status, hint: acc.method_hint });
    const provider = await providerFor(admin, acc.provider, environment);
    if (provider instanceof Response) return json({ status: acc.status, hint: acc.method_hint });
    try {
      const s = await provider.payeeStatus(acc.provider_account_id);
      if (s.status !== acc.status) {
        await admin.rpc("plan_b_payee_status", { p_provider: acc.provider, p_account_id: acc.provider_account_id, p_status: s.status, p_note: s.note ?? null });
      }
      return json({ status: s.status, hint: acc.method_hint });
    } catch {
      return json({ status: acc.status, hint: acc.method_hint });
    }
  }

  // Everything below is about one task.
  if (!body.taskId || !UUID.test(body.taskId)) return json({ error: "Which task is this for?" }, 400);
  const taskId = body.taskId;

  // ---- checkout ----------------------------------------------------------------------------
  if (body.action === "checkout") {
    if (cfg.flow !== "plan_b") return json({ error: "This task is paid from the wallet.", code: "WALLET_FLOW" }, 409);
    const { data: terms, error: termsErr } = await admin.rpc("plan_b_checkout_terms", { p_task_id: taskId, p_user: userId });
    if (termsErr) return json({ error: plain(termsErr.message) }, 409);
    const t = terms as Record<string, unknown>;
    if (t.status === "held") return json({ ok: true, status: "held" });

    const provider = await providerFor(admin, String(t.provider), environment);
    if (provider instanceof Response) return provider;
    const returnUrl = safeReturnUrl(body.returnUrl, Deno.env.get("ALLOWED_ORIGINS"));
    const ctx = { chargedMinor: Number(t.charged_minor), title: String(t.task_title ?? "TaskDrop task"), returnUrl };

    let orderId = typeof t.provider_order_id === "string" ? t.provider_order_id : null;
    let ref = typeof t.checkout_url === "string" ? t.checkout_url : null;
    if (!orderId || !ref) {
      try {
        const made = await provider.startPayment({
          holdId: String(t.hold_id), taskId, title: ctx.title, chargedMinor: ctx.chargedMinor,
          workerShareMinor: Number(t.worker_share_minor), payeeAccountId: String(t.payee_account_id),
          posterId: userId, posterPhone: user.phone ? `+${user.phone.replace(/^\+/, "")}` : null,
          posterEmail: user.email ?? null, returnUrl,
        });
        // The first order kept for this hold wins, so two taps never show two orders to pay.
        const { data: kept, error: keepErr } = await admin.rpc("plan_b_set_order", {
          p_hold_id: String(t.hold_id), p_order_id: made.orderId, p_checkout_url: made.ref,
        });
        if (keepErr) throw new Error(keepErr.message);
        const k = kept as { order_id?: string; checkout_url?: string; status?: string };
        if (k.status !== "awaiting_payment" || !k.order_id) return json({ error: "This hire is no longer waiting for payment." }, 409);
        orderId = k.order_id;
        ref = k.checkout_url ?? made.ref;
      } catch (e) {
        await logServer("error", "money", "could not start the payment", { task_id: taskId, provider: provider.name, error: e instanceof Error ? e.message : String(e) });
        await captureServerError(e, { fn: "money", step: "checkout" });
        return json({ error: "The payment company did not open the payment. Nothing was charged. Please try again." }, 502);
      }
    }
    const page = provider.checkoutPage(ref!, { ...ctx, orderId: orderId! });
    return json({
      ok: true, status: "awaiting_payment", holdId: t.hold_id, provider: provider.name,
      chargedMinor: ctx.chargedMinor, workerShareMinor: Number(t.worker_share_minor),
      simulated: provider.name === "simulated", checkout: page,
    });
  }

  // Both the sync and the settle actions read the task's newest hold with the service role.
  const { data: hold } = await admin.from("task_holds")
    .select("id, status, provider, poster_id, worker_id, provider_order_id, charged_minor")
    .eq("task_id", taskId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!hold || (hold.poster_id !== userId && hold.worker_id !== userId)) return json({ error: "No payment found for this task" }, 404);

  // ---- sync --------------------------------------------------------------------------------
  if (body.action === "sync") {
    if (hold.poster_id !== userId) return json({ error: "Only the poster pays for a task" }, 403);
    if (hold.status !== "awaiting_payment" || !hold.provider_order_id) return json({ ok: true, status: hold.status });
    const provider = await providerFor(admin, hold.provider, environment);
    if (provider instanceof Response) return provider;

    let paid: { paid: boolean; paymentId?: string | null; transferId?: string | null; amountMinor?: number | null };
    if (provider.name === "simulated") {
      // The test payment: only on staging (makeProvider refuses elsewhere) and only when asked for.
      if (!body.simulate) return json({ ok: true, status: hold.status });
      paid = { paid: true, paymentId: `simpay_${hold.id}`, transferId: `simtr_${hold.id}`, amountMinor: Number(hold.charged_minor) };
    } else {
      try {
        paid = await provider.readPayment(hold.provider_order_id);
      } catch (e) {
        await logServer("warn", "money", "could not read the payment", { task_id: taskId, error: e instanceof Error ? e.message : String(e) });
        return json({ ok: true, status: hold.status, checked: false });
      }
    }
    if (!paid.paid) return json({ ok: true, status: hold.status });
    const { data: res, error } = await admin.rpc("plan_b_mark_paid", {
      p_order_id: hold.provider_order_id, p_payment_id: paid.paymentId ?? null,
      p_transfer_id: paid.transferId ?? null, p_amount_minor: paid.amountMinor ?? null,
    });
    if (error) {
      await captureServerError(error, { fn: "money", step: "mark_paid" });
      return json({ error: "Paid, but not recorded yet. It will be, shortly." }, 500);
    }
    if (res === "amount_mismatch") {
      await logServer("error", "money", "paid amount differs from the hold, kept for staff", { task_id: taskId });
      await captureSecurityEvent("amount_mismatch", "money");
    }
    if (res === "refund") {
      // Paid for a hire that had ended: send it straight back.
      await runMoves(admin, provider, hold.id).catch((e) => captureServerError(e, { fn: "money", step: "late_refund" }));
    }
    return json({ ok: true, status: res === "held" || res === "already" ? "held" : String(res) });
  }

  // ---- settle ------------------------------------------------------------------------------
  if (body.action === "settle") {
    if (!["release_asked", "refund_asked", "split_asked"].includes(hold.status)) return json({ ok: true, status: hold.status });
    const provider = await providerFor(admin, hold.provider, environment);
    if (provider instanceof Response) return json({ ok: true, status: hold.status, later: true });
    try {
      const outcomes = await runMoves(admin, provider, hold.id);
      const last = outcomes[outcomes.length - 1];
      await logServer("info", "money", "settle ran", { task_id: taskId, done: last?.done ?? "nothing" });
    } catch (e) {
      // Inngest's money-moves job retries every 10 minutes; the person needs no error here.
      await captureServerError(e, { fn: "money", step: "settle" });
    }
    const { data: after } = await admin.from("task_holds").select("status").eq("id", hold.id).maybeSingle();
    return json({ ok: true, status: after?.status ?? hold.status });
  }

  return json({ error: "Unknown action" }, 400);
}));
