import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { secret } from "../_shared/secrets.ts";

/**
 * Razorpay money-in for TaskDrop.
 *
 *   create-link -> opens a Razorpay Payment Link for either funding a task's
 *                  escrow or topping the wallet up, and records it in payments.
 *   sync        -> re-reads the link from Razorpay and settles our side:
 *                  a paid top-up credits the wallet balance.
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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const RZP_ID = await secret("RAZORPAY_KEY_ID");
  const RZP_SECRET = await secret("RAZORPAY_KEY_SECRET");
  if (!RZP_ID || !RZP_SECRET) {
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

  // Identify the caller from their JWT.
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "Sign in first" }, 401);
  const userId = userData.user.id;

  let body: {
    action?: string;
    purpose?: "escrow" | "topup";
    amountMinor?: number;
    taskId?: string | null;
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
    const purpose = body.purpose === "topup" ? "topup" : "escrow";
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

    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Invalid amount" }, 400);

    const description =
      purpose === "escrow" ? "TaskDrop escrow funding" : "TaskDrop wallet top-up";

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
        ...(body.returnUrl ? { callback_url: body.returnUrl, callback_method: "get" } : {}),
      }),
    });
    const link = await res.json();
    if (!res.ok) return json({ error: link?.error?.description ?? "Razorpay rejected the request" }, 502);

    const { data: row, error } = await admin
      .from("payments")
      .insert({
        user_id: userId,
        task_id: body.taskId ?? null,
        purpose,
        amount_minor: amount,
        provider_ref: link.id,
        link_url: link.short_url,
      })
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);

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
    if (!res.ok) return json({ error: link?.error?.description ?? "Could not read the payment" }, 502);

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
      if (fundErr) console.error("could not fund task", row.task_id, fundErr.message);
    }

    // A settled top-up becomes spendable balance. Escrow holds are attached to
    // the assignment when the quote is locked, so nothing to move here.
    if (paid && row.purpose === "topup") {
      const { data: w } = await admin
        .from("wallets")
        .select("balance_minor")
        .eq("user_id", userId)
        .single();
      await admin
        .from("wallets")
        .update({ balance_minor: (w?.balance_minor ?? 0) + row.amount_minor })
        .eq("user_id", userId);
    }

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
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      },
    );

    const { data: dueRows, error: dueErr } = await asUser.rpc("escrow_refund_due", {
      p_task_id: taskId,
    });
    if (dueErr) return json({ error: dueErr.message }, 400);

    const due = Array.isArray(dueRows) ? dueRows[0] : dueRows;
    const amount = Number(due?.due_minor ?? 0);
    if (!due?.payment_id || amount <= 0) {
      return json({ ok: true, refundedMinor: 0, reason: due?.reason ?? "Nothing to refund" });
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
      console.error("REFUND SENT BUT NOT RECORDED", taskId, refund.id, recErr.message);
      return json({ error: "The refund was sent but not recorded. Tell support before retrying." }, 500);
    }

    return json({ ok: true, refundedMinor: amount, refundRef: refund.id ?? null });
  }

  return json({ error: "Unknown action" }, 400);
});
