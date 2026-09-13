import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Razorpay money-in for TaskDrop.
 *
 *   create-link -> opens a Razorpay Payment Link for either funding a task's
 *                  escrow or topping the wallet up, and records it in payments.
 *   sync        -> re-reads the link from Razorpay and settles our side:
 *                  a paid top-up credits the wallet balance.
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

const RZP_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const RZP_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
const RZP = "https://api.razorpay.com/v1";

function rzpHeaders() {
  return {
    Authorization: `Basic ${btoa(`${RZP_ID}:${RZP_SECRET}`)}`,
    "Content-Type": "application/json",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (!RZP_ID || !RZP_SECRET) {
    return json(
      {
        error:
          "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET as Edge Function secrets.",
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
    const amount = Math.round(Number(body.amountMinor ?? 0));
    const purpose = body.purpose === "topup" ? "topup" : "escrow";
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Invalid amount" }, 400);

    const description =
      purpose === "escrow" ? "TaskDrop escrow funding" : "TaskDrop wallet top-up";

    const res = await fetch(`${RZP}/payment_links`, {
      method: "POST",
      headers: rzpHeaders(),
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

    return json({ ok: true, paymentId: row.id, url: link.short_url });
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
    if (row.status === "paid") return json({ ok: true, status: "paid", alreadySettled: true });

    const res = await fetch(`${RZP}/payment_links/${row.provider_ref}`, { headers: rzpHeaders() });
    const link = await res.json();
    if (!res.ok) return json({ error: link?.error?.description ?? "Could not read the payment" }, 502);

    const paid = link.status === "paid";
    const status = paid ? "paid" : link.status === "cancelled" ? "cancelled" : "created";

    await admin
      .from("payments")
      .update({ status, paid_at: paid ? new Date().toISOString() : null })
      .eq("id", row.id);

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

    return json({ ok: true, status });
  }

  return json({ error: "Unknown action" }, 400);
});
