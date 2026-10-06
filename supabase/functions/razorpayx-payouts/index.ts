import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { secret } from "../_shared/secrets.ts";
import { balance, giveBack, sendPayout, syncOpen, type XConfig } from "../_shared/razorpayx.ts";

/**
 * Sends workers' withdrawals through RazorpayX Payouts. The rules that keep a
 * withdrawal from being paid twice or lost are in ../_shared/razorpayx.ts and
 * migration 066.
 *
 *   send        { payoutId }  the worker's own withdrawal, straight after
 *                             request_withdrawal (the app calls this).
 *   sync-mine   {}            the worker's open withdrawals: send any never
 *                             sent, re-check any RazorpayX has gone quiet on.
 *                             The app calls it when the Withdraw screen opens.
 *   check-all   {}            admins: the same for everyone ("Check with
 *                             RazorpayX" on the Payouts page). "send-pending"
 *                             is the old name and still works.
 *   give-back   { payoutId }  admins: a withdrawal that never reached
 *                             RazorpayX goes back to the worker's earnings --
 *                             only after RazorpayX confirms it has no payout.
 *   balance     {}            admins: the RazorpayX account balance.
 *
 * settings.payout_method ('manual' by default) decides whether "send" and
 * "sync-mine" do anything; in manual mode an admin pays each withdrawal by hand.
 *
 * Needs RAZORPAYX_ACCOUNT_NUMBER, and RAZORPAYX_KEY_ID / RAZORPAYX_KEY_SECRET
 * (or the Razorpay keys, if RazorpayX is on the same account). Without them it
 * says so and changes nothing: withdrawals wait, and can be paid by hand.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(jwt);
  const userId = who?.user?.id;
  if (!userId) return json({ error: "Sign in first" }, 401);

  let body: { action?: string; payoutId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  const { data: adminRow } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  const isAdmin = Boolean(adminRow);

  const account = await secret("RAZORPAYX_ACCOUNT_NUMBER");
  const keyId = (await secret("RAZORPAYX_KEY_ID")) || (await secret("RAZORPAY_KEY_ID"));
  const keySecret = (await secret("RAZORPAYX_KEY_SECRET")) || (await secret("RAZORPAY_KEY_SECRET"));
  if (!account || !keyId || !keySecret) {
    // Not an error for the worker: the request stands and can be paid by hand.
    return json({ configured: false, note: "RazorpayX is not set up yet; the withdrawal waits." });
  }
  const cfg: XConfig = { account, keyId, keySecret };

  // The admin's switch (Payouts page). Anything but an explicit 'razorpayx' means
  // an admin pays by hand, so nothing is sent on a worker's behalf.
  const { data: methodRow } = await admin.from("settings").select("value").eq("key", "payout_method").maybeSingle();
  const method = methodRow?.value === "razorpayx" ? "razorpayx" : "manual";
  if (method === "manual" && (body.action === "send" || body.action === "sync-mine")) {
    return json({ configured: true, method, payouts: [], note: "Payouts are set to manual; an admin pays this withdrawal by hand." });
  }

  switch (body.action) {
    case "send": {
      if (!body.payoutId) return json({ error: "Which withdrawal?" }, 400);
      const { data: p } = await admin.from("payouts").select("user_id").eq("id", body.payoutId).maybeSingle();
      if (!p) return json({ error: "That withdrawal does not exist" }, 404);
      if (p.user_id !== userId && !isAdmin) return json({ error: "That is not your withdrawal" }, 403);
      return json({ configured: true, ...(await sendPayout(admin, cfg, body.payoutId)) });
    }
    case "sync-mine":
      return json({ configured: true, payouts: await syncOpen(admin, cfg, userId, 10) });
    case "check-all":
    case "send-pending":
      if (!isAdmin) return json({ error: "Admins only" }, 403);
      return json({ configured: true, payouts: await syncOpen(admin, cfg, null, 50) });
    case "give-back":
      if (!isAdmin) return json({ error: "Admins only" }, 403);
      if (!body.payoutId) return json({ error: "Which withdrawal?" }, 400);
      return json({ configured: true, ...(await giveBack(admin, cfg, body.payoutId)) });
    case "balance":
      if (!isAdmin) return json({ error: "Admins only" }, 403);
      return json({ configured: true, ...(await balance(cfg)) });
    default:
      return json({ error: "Unknown action" }, 400);
  }
});
