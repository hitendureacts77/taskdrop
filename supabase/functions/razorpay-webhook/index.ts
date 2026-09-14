import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Razorpay webhook receiver.
 *
 * Without this, a payment only settles if the payer comes back to the app and
 * taps "I've paid" — close the tab after paying and the money is taken while
 * the task stays unfunded. Razorpay calls this the moment it happens, so
 * settlement no longer depends on anyone's browser.
 *
 * This function is deliberately public (verify_jwt = false): Razorpay has no
 * Supabase session. What makes it safe is the signature — every request is
 * HMAC-SHA256'd with RAZORPAY_WEBHOOK_SECRET, and anything that does not match
 * is refused before a single row is touched.
 *
 * Needs RAZORPAY_WEBHOOK_SECRET set as a function secret. Point Razorpay at:
 *   https://<project>.supabase.co/functions/v1/razorpay-webhook
 * subscribed to payment_link.paid.
 */

const SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Constant-time compare, so a wrong signature can't be guessed byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signatureFor(raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!SECRET) {
    return json(
      {
        error:
          "Webhook is not configured. Set RAZORPAY_WEBHOOK_SECRET as an Edge Function secret.",
        configured: false,
      },
      503,
    );
  }

  // The signature is over the exact bytes Razorpay sent, so read the body as
  // text and parse it afterwards — re-serialising JSON would change it.
  const raw = await req.text();
  const sent = req.headers.get("x-razorpay-signature") ?? "";
  const expected = await signatureFor(raw);
  if (!sent || !safeEqual(sent, expected)) {
    return json({ error: "Bad signature" }, 401);
  }

  let event: {
    event?: string;
    payload?: {
      payment_link?: { entity?: { id?: string; status?: string } };
      payment?: { entity?: { id?: string } };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "Expected JSON" }, 400);
  }

  const link = event.payload?.payment_link?.entity;
  if (!link?.id) {
    // Not an event we act on. Acknowledge it, or Razorpay will keep retrying.
    return json({ ok: true, ignored: event.event ?? "unknown" });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: row, error } = await admin
    .from("payments")
    .select("*")
    .eq("provider_ref", link.id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!row) return json({ ok: true, ignored: "unknown payment link" });

  // Razorpay retries until it gets a 2xx, so the same event can arrive twice.
  // Settling an already-settled payment must not credit the wallet again.
  if (row.status === "paid") return json({ ok: true, alreadySettled: true });

  const paid = link.status === "paid" || event.event === "payment_link.paid";
  const status = paid ? "paid" : link.status === "cancelled" ? "cancelled" : "created";

  await admin
    .from("payments")
    .update({ status, paid_at: paid ? new Date().toISOString() : null })
    .eq("id", row.id);

  // A settled top-up becomes spendable balance. Escrow holds are attached to
  // the assignment when the quote is locked, so nothing to move for those.
  if (paid && row.purpose === "topup") {
    const { data: w } = await admin
      .from("wallets")
      .select("balance_minor")
      .eq("user_id", row.user_id)
      .single();
    await admin
      .from("wallets")
      .update({ balance_minor: (w?.balance_minor ?? 0) + row.amount_minor })
      .eq("user_id", row.user_id);
  }

  return json({ ok: true, status });
});
