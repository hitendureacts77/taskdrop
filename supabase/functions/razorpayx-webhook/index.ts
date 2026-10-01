import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { secret } from "../_shared/secrets.ts";
import { handleWebhook } from "../_shared/razorpayx.ts";

/**
 * RazorpayX webhook: its word on each withdrawal.
 *
 * Public (verify_jwt = false): RazorpayX has no Supabase session. Every
 * delivery must carry an HMAC-SHA256 signature made with
 * RAZORPAYX_WEBHOOK_SECRET; anything that does not match is refused before a
 * row is read.
 *
 * The payout's own status decides (record_payout_status, migration 066):
 *   processed                                -> paid, bank reference kept
 *   failed / rejected / cancelled / reversed -> money back in earnings, once
 *   reversed after being paid                -> money back in earnings
 *   queued / pending / processing ...        -> still on its way (shown to admins)
 *
 * Point RazorpayX at https://<project>.supabase.co/functions/v1/razorpayx-webhook
 * with payout.processed, payout.reversed, payout.failed, payout.rejected,
 * payout.updated, payout.queued, payout.pending and payout.initiated.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const raw = await req.text();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const out = await handleWebhook(
    admin,
    raw,
    req.headers.get("x-razorpay-signature") ?? "",
    await secret("RAZORPAYX_WEBHOOK_SECRET"),
  );
  return json(out.body, out.status);
});
