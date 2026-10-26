import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { secret } from "../_shared/secrets.ts";
import { gatewayHeaders } from "../_shared/gateway.ts";
import { guardKey } from "../_shared/keyGuard.ts";
import { guarded, captureServerError, logServer } from "../_shared/monitoring.ts";
import { PLATFORM_HEADER, VERSION_HEADER, parseControls, readClient, featureOffMessage } from "../_shared/controls.ts";

/**
 * Razorpay money-in for TaskDrop.
 *
 *   create-link -> opens a Razorpay Payment Link for either funding a task's
 *                  escrow or topping the wallet up, and records it in payments.
 *   sync        -> re-reads the link from Razorpay and settles our side:
 *                  a paid top-up becomes task credits (never withdrawable).
 *   refund-escrow -> sends a cancelled task's escrow back to the poster.
 *                  How much is owed is decided in Postgres, never by the
 *                  caller, and the refund is written down only after Razorpay
 *                  has accepted it.
 *
 * Payment Links are used deliberately: the same flow works in the browser and
 * in Expo Go, with no native SDK or custom dev build.
 *
 * Needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET set as function secrets.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region, " + PLATFORM_HEADER + ", " + VERSION_HEADER,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const RZP = "https://api.razorpay.com/v1";

function rzpHeaders(id: string, key: string) {
  return {
    Authorization: `Basic ${btoa(`${id}:${key}`)}`,
    "Content-Type": "application/json",
  };
}

/** Whether the task behind a payment is actually funded right now. */
async function taskIsFunded(
  admin: ReturnType<typeof createClient>,
  taskId: string | null,
): Promise<boolean> {
  if (!taskId) return false;
  const { data } = await admin.from("tasks").select("funded_at").eq("id", taskId).maybeSingle();
  return Boolean(data?.funded_at);
}

Deno.serve(guarded("razorpay", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const RZP_ID = await secret("RAZORPAY_KEY_ID");
  const RZP_SECRET = await secret("RAZORPAY_KEY_SECRET");
  if (!RZP_ID || !RZP_SECRET) {
    await logServer("error", "razorpay", "Razorpay keys are not configured");
    return json(
      {
        error:
          "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET as Edge Function secrets, or store them in Vault.",
        configured: false,
      },
      503,
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // A live key in staging (or a test key in production) stops every action here
  // before anything is sent to Razorpay or written down.
  const wrongKey = await guardKey(admin, "razorpay", RZP_ID);
  if (wrongKey) return json(wrongKey.body, wrongKey.status);

  // Identify the caller from their JWT.
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "Sign in first" }, 401);
  const userId = userData.user.id;

  let body: {
    action?: string;
    purpose?: "escrow" | "topup" | "promotion";
    amountMinor?: number;
    taskId?: string | null;
    promotionId?: string;
    paymentId?: string;
    returnUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  // ---- create-link --------------------------------------------------------
  if (body.action === "create-link") {
    const purpose = body.purpose === "topup" ? "topup" : body.purpose === "promotion" ? "promotion" : "escrow";
    // Which task the payment row is tied to. A promotion takes it from the campaign, not from the caller.
    let paymentTaskId: string | null = body.taskId ?? null;

    // The admin panel's "top-ups" switch (migration 092), decided here: the
    // money comes in through this function, not the api one. If the switches
    // cannot be read the top-up goes ahead.
    if (purpose === "topup") {
      const client = readClient(req.headers);
      const { data: cfg } = await admin.rpc("get_app_controls", { p_platform: client.platform, p_version: client.appVersion });
      const controls = parseControls(cfg);
      if (controls && !controls.topups) return json({ error: featureOffMessage("topups"), code: "FEATURE_OFF" }, 403);
    }

    let amount = Math.round(Number(body.amountMinor ?? 0));

    // Escrow is priced here, from the assignment, and the number the client
    // sent is discarded.
    //
    // It used to be trusted, and the client worked it out as
    // Math.round(quote * 1.03) in float while lock_bid worked it out as
    // round(quote * 1.03) in numeric. Those agree almost always -- and when
    // they did not, the payment came in a paisa short, fund_task refused it,
    // and the task stayed unfunded with the money collected. One number, one
    // place, and that whole class of bug is gone.
    if (purpose === "escrow") {
      if (!body.taskId) return json({ error: "Which task is this for?" }, 400);

      const { data: task, error: taskErr } = await admin
        .from("tasks")
        .select("id, poster_id, status, funded_at")
        .eq("id", body.taskId)
        .maybeSingle();
      if (taskErr) return json({ error: taskErr.message }, 500);
      if (!task) return json({ error: "That task no longer exists" }, 404);
      if (task.poster_id !== userId) return json({ error: "Only the poster funds a task" }, 403);
      if (task.funded_at) {
        return json({ error: "This task is already funded", alreadyFunded: true }, 409);
      }

      const { data: assignment } = await admin
        .from("assignments")
        .select("escrow_minor")
        .eq("task_id", task.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!assignment?.escrow_minor) {
        return json({ error: "No quote has been locked on this task yet" }, 400);
      }
      amount = Number(assignment.escrow_minor);
    }

    // A promotion is priced from the campaign row start_promotion wrote, like
    // escrow is priced from the assignment: the number the client sent is discarded.
    if (purpose === "promotion") {
      if (!body.promotionId) return json({ error: "Which campaign is this for?" }, 400);
      const { data: promo, error: promoErr } = await admin
        .from("task_promotions")
        .select("id, user_id, task_id, status, amount_minor")
        .eq("id", body.promotionId)
        .maybeSingle();
      if (promoErr) return json({ error: promoErr.message }, 500);
      if (!promo) return json({ error: "That campaign no longer exists" }, 404);
      if (promo.user_id !== userId) return json({ error: "That is not your campaign" }, 403);
      if (promo.status !== "pending") return json({ error: "That campaign is no longer waiting for payment" }, 409);
      amount = Number(promo.amount_minor);
      paymentTaskId = promo.task_id;
    }

    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Invalid amount" }, 400);

    const description =
      purpose === "escrow" ? "TaskDrop escrow funding" : purpose === "promotion" ? "TaskDrop promotion" : "TaskDrop wallet top-up";

    const res = await fetch(`${RZP}/payment_links`, {
      method: "POST",
      headers: rzpHeaders(RZP_ID, RZP_SECRET),
      body: JSON.stringify({
        amount,
        currency: "INR",
        description,
        reference_id: `${purpose}-${userId.slice(0, 8)}-${Date.now()}`,
        notify: { sms: false, email: false },
        reminder_enable: false,
        // Ask for UPI explicitly, first, alongside the rest. Checkout otherwise
        // falls back to the account's defaults, which left UPI off the list.
        // (UPI must also be enabled for the account in the Razorpay dashboard.)
        options: {
          checkout: {
            method: { upi: "1", card: "1", netbanking: "1", wallet: "1" },
            config: {
              display: {
                blocks: {
                  upi: { name: "Pay with UPI", instruments: [{ method: "upi" }] },
                },
                sequence: ["block.upi"],
                preferences: { show_default_blocks: true },
              },
            },
          },
        },
        ...(body.returnUrl ? { callback_url: body.returnUrl, callback_method: "get" } : {}),
      }),
    });
    const link = await res.json();
    if (!res.ok) {
      await logServer("error", "razorpay", "Razorpay rejected the payment link", { purpose, task_id: body.taskId ?? null, http_status: res.status, reason: link?.error?.description ?? null, user_id: userId });
      return json({ error: link?.error?.description ?? "Razorpay rejected the request" }, 502);
    }

    const { data: row, error } = await admin
      .from("payments")
      .insert({
        user_id: userId,
        task_id: paymentTaskId,
        purpose,
        amount_minor: amount,
        provider_ref: link.id,
        link_url: link.short_url,
      })
      .select()
      .single();
    if (error) {
      await logServer("error", "razorpay", "link created but payment row not saved", { link_id: link.id, purpose, error: error.message, user_id: userId });
      return json({ error: error.message }, 500);
    }
    await logServer("info", "razorpay", "payment link created", { payment_id: row.id, purpose, task_id: body.taskId ?? null, amount_minor: amount, user_id: userId });

    // The amount is echoed back because the caller no longer decides it.
    return json({ ok: true, paymentId: row.id, url: link.short_url, amountMinor: amount });
  }

  // ---- sync ---------------------------------------------------------------
  if (body.action === "sync") {
    const { data: row, error } = await admin
      .from("payments")
      .select("*")
      .eq("id", body.paymentId ?? "")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: "Payment not found" }, 404);
    if (row.status === "paid") {
      return json({
        ok: true,
        status: "paid",
        alreadySettled: true,
        funded: await taskIsFunded(admin, row.task_id),
      });
    }

    const res = await fetch(`${RZP}/payment_links/${row.provider_ref}`, { headers: rzpHeaders(RZP_ID, RZP_SECRET) });
    const link = await res.json();
    if (!res.ok) {
      await logServer("error", "razorpay", "could not read payment link", { payment_id: row.id, http_status: res.status, reason: link?.error?.description ?? null });
      return json({ error: link?.error?.description ?? "Could not read the payment" }, 502);
    }

    const paid = link.status === "paid";
    const status = paid ? "paid" : link.status === "cancelled" ? "cancelled" : "created";

    // A payment link is not refundable; the payment underneath it is. Grab
    // that id now, while we are already holding the link.
    const payId: string | null = link?.payments?.[0]?.payment_id ?? null;

    await admin
      .from("payments")
      .update({
        status,
        paid_at: paid ? new Date().toISOString() : null,
        ...(payId ? { provider_payment_id: payId } : {}),
      })
      .eq("id", row.id);

    // Funding the task here too, so the app does not depend on the webhook
    // having arrived first. fund_task_from_payment is idempotent, so whichever
    // gets there first wins and the other is a no-op.
    if (paid && row.purpose === "escrow" && row.task_id) {
      const { error: fundErr } = await admin.rpc("fund_task_from_payment", {
        p_payment_id: row.id,
      });
      if (fundErr) {
        await logServer("error", "razorpay", "paid but could not fund task", { payment_id: row.id, task_id: row.task_id, error: fundErr.message });
        await captureServerError(fundErr, { fn: "razorpay", step: "fund_task" });
      }
    }

    // A settled top-up becomes task credits: spendable on tasks, never
    // withdrawable. credit_topup is idempotent per payment, so this and the
    // webhook can both call it. Escrow holds are attached to the assignment
    // when the quote is locked, so nothing to move here.
    if (paid && row.purpose === "topup") {
      const { error: creditErr } = await admin.rpc("credit_topup", { p_payment_id: row.id });
      if (creditErr) {
        await logServer("error", "razorpay", "paid but could not credit top-up", { payment_id: row.id, error: creditErr.message });
        await captureServerError(creditErr, { fn: "razorpay", step: "credit_topup" });
      }
    }
    if (paid) await logServer("info", "razorpay", "payment settled by app check", { payment_id: row.id, purpose: row.purpose });

    // Settling the payment and funding the task are two different things, and
    // the screen that asks needs the second one. Reporting only "paid" is how
    // a poster gets told the money is held in escrow while funded_at is still
    // null and the worker cannot start.
    return json({
      ok: true,
      status,
      funded: paid ? await taskIsFunded(admin, row.task_id) : false,
    });
  }

  // ---- refund-escrow ------------------------------------------------------
  if (body.action === "refund-escrow") {
    const taskId = String(body.taskId ?? "");
    if (!taskId) return json({ error: "Which task?" }, 400);

    // Asked as the caller, so the function's own checks apply: it must be
    // their task, it must be cancelled, and it must actually have been funded.
    const asUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${jwt}`, ...(await gatewayHeaders()) } },
      },
    );

    const { data: dueRows, error: dueErr } = await asUser.rpc("escrow_refund_due", {
      p_task_id: taskId,
    });
    if (dueErr) return json({ error: dueErr.message }, 400);

    const due = Array.isArray(dueRows) ? dueRows[0] : dueRows;
    if (!due?.payment_id || Number(due?.due_minor ?? 0) <= 0) {
      return json({ ok: true, refundedMinor: 0, reason: due?.reason ?? "Nothing to refund" });
    }

    // The poster's button and the admin panel can both ask at the same moment.
    // Claim the payment first, then re-read what is owed: a second caller
    // either finds the claim taken or sees the first refund already recorded,
    // so the same money is never sent back twice (migration 062).
    const { data: claimed, error: claimErr } = await admin.rpc("claim_escrow_refund", {
      p_payment_id: due.payment_id,
    });
    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claimed) {
      return json({ error: "A refund for this payment is already being sent. Check again in a few minutes." }, 409);
    }
    const releaseClaim = () => admin.rpc("release_escrow_refund_claim", { p_payment_id: due.payment_id });

    const { data: freshRows, error: freshErr } = await asUser.rpc("escrow_refund_due", {
      p_task_id: taskId,
    });
    const fresh = Array.isArray(freshRows) ? freshRows[0] : freshRows;
    const amount = Number(fresh?.due_minor ?? 0);
    if (freshErr || !fresh?.payment_id || fresh.payment_id !== due.payment_id || amount <= 0) {
      await releaseClaim();
      if (freshErr) return json({ error: freshErr.message }, 400);
      return json({ ok: true, refundedMinor: 0, reason: fresh?.reason ?? "Nothing to refund" });
    }

    // An older payment was recorded before we stored the payment id. Read it
    // off the link rather than making the poster wait for a person.
    let payId: string | null = due.provider_payment_id ?? null;
    if (!payId) {
      const { data: payRow } = await admin
        .from("payments")
        .select("provider_ref")
        .eq("id", due.payment_id)
        .maybeSingle();
      if (payRow?.provider_ref) {
        const lr = await fetch(`${RZP}/payment_links/${payRow.provider_ref}`, {
          headers: rzpHeaders(RZP_ID, RZP_SECRET),
        });
        const linkRow = await lr.json();
        payId = linkRow?.payments?.[0]?.payment_id ?? null;
        if (payId) {
          await admin
            .from("payments")
            .update({ provider_payment_id: payId })
            .eq("id", due.payment_id);
        }
      }
    }
    if (!payId) {
      await releaseClaim();
      await logServer("error", "razorpay", "refund blocked: no Razorpay payment id", { task_id: taskId, payment_id: due.payment_id });
      return json(
        { error: "Could not find the Razorpay payment behind this escrow. Refund it from the dashboard." },
        502,
      );
    }

    const res = await fetch(`${RZP}/payments/${payId}/refund`, {
      method: "POST",
      headers: rzpHeaders(RZP_ID, RZP_SECRET),
      body: JSON.stringify({
        amount,
        speed: "normal",
        notes: { task_id: taskId, reason: "TaskDrop — cancelled task" },
      }),
    });
    const refund = await res.json();
    if (!res.ok) {
      await releaseClaim();
      await logServer("error", "razorpay", "Razorpay refused the refund", { task_id: taskId, payment_id: due.payment_id, amount_minor: amount, http_status: res.status, reason: refund?.error?.description ?? null });
      return json({ error: refund?.error?.description ?? "Razorpay refused the refund" }, 502);
    }

    // Only now is it true. If this write fails the money has still moved, so
    // the failure is loud rather than swallowed.
    const { error: recErr } = await admin.rpc("record_escrow_refund", {
      p_payment_id: due.payment_id,
      p_ref: refund.id ?? null,
      p_amount_minor: amount,
    });
    if (recErr) {
      // The worst case in this file: money has moved and our books do not say so.
      await logServer("error", "razorpay", "REFUND SENT BUT NOT RECORDED", { task_id: taskId, payment_id: due.payment_id, refund_ref: refund.id ?? null, amount_minor: amount, error: recErr.message });
      await captureServerError(new Error(`REFUND SENT BUT NOT RECORDED: ${recErr.message}`), { fn: "razorpay", step: "record_escrow_refund", task_id: String(taskId) }, "fatal");
      // Keep the claim forever so nobody can send it again until a person has
      // recorded this refund by hand and cleared payments.refund_claimed_at.
      await admin.from("payments").update({ refund_claimed_at: "infinity" }).eq("id", due.payment_id);
      return json({ error: "The refund was sent but not recorded. Tell support before retrying." }, 500);
    }
    await releaseClaim();
    await logServer("info", "razorpay", "escrow refunded", { task_id: taskId, payment_id: due.payment_id, amount_minor: amount, refund_ref: refund.id ?? null });

    return json({ ok: true, refundedMinor: amount, refundRef: refund.id ?? null });
  }

  return json({ error: "Unknown action" }, 400);
}));
