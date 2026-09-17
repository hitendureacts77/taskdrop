import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { secret } from "../_shared/secrets.ts";

/**
 * One-time wiring between Razorpay and this project.
 *
 * Registering the webhook by hand means copying the signing secret out of
 * Vault, through a person, into a browser form — and a secret that has been
 * seen is a secret that has to be rotated. This does it without that: it
 * generates the secret here, stores it in Vault, and hands it straight to
 * Razorpay. Nobody ever sees the value, including whoever runs this.
 *
 * It is deliberately narrow, and it is single-shot. The URL is not a parameter
 * — it is always this project's own razorpay-webhook endpoint — and it refuses
 * outright once that webhook exists. So it can be called by anyone exactly
 * once, to do the one correct thing, and is inert from then on. That is what
 * lets it run without a session: registering the webhook is the step you have
 * to take before anyone can sign in and pay.
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
const EVENTS = ["payment_link.paid", "refund.processed"];

function rzpHeaders(id: string, key: string) {
  return {
    Authorization: `Basic ${btoa(`${id}:${key}`)}`,
    "Content-Type": "application/json",
  };
}

/** 32 bytes of CSPRNG, hex. Long enough that nothing but the key matters. */
function freshSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const RZP_ID = await secret("RAZORPAY_KEY_ID");
  const RZP_SECRET = await secret("RAZORPAY_KEY_SECRET");
  if (!RZP_ID || !RZP_SECRET) return json({ error: "Razorpay is not configured" }, 503);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.action !== "ensure-webhook") return json({ error: "Unknown action" }, 400);

  const hooks = rzpHeaders(RZP_ID, RZP_SECRET);
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/razorpay-webhook`;

  const listRes = await fetch(`${RZP}/webhooks`, { headers: hooks });
  const list = await listRes.json();
  if (!listRes.ok) {
    return json({ error: list?.error?.description ?? "Could not list webhooks" }, 502);
  }
  const existing = (list.items ?? []).find((w: { url?: string }) => w.url === url);

  // The guard. Once the webhook is there, this endpoint does nothing for
  // anyone, forever. Rotating the secret afterwards is a Razorpay dashboard
  // job, not something to leave standing open here.
  if (existing) {
    return json(
      {
        ok: true,
        alreadyRegistered: true,
        webhookId: existing.id ?? null,
        url,
        events: existing.active_events ?? EVENTS,
      },
      409,
    );
  }

  const value = freshSecret();

  // Stored before it is registered. The other order risks Razorpay signing
  // with a secret this project does not know, which is a deaf webhook and no
  // way to tell why.
  const { error: setErr } = await admin.rpc("set_app_secret", {
    p_name: "RAZORPAY_WEBHOOK_SECRET",
    p_value: value,
  });
  if (setErr) return json({ error: `Could not store the secret: ${setErr.message}` }, 500);

  // Razorpay has documented both shapes for this field over time. Try the
  // array, fall back to the map, rather than guessing which account is which.
  const send = async (events: unknown) =>
    await fetch(`${RZP}/webhooks`, {
      method: "POST",
      headers: hooks,
      body: JSON.stringify({ url, secret: value, events }),
    });

  let res = await send(EVENTS);
  let out = await res.json();
  if (!res.ok) {
    res = await send(Object.fromEntries(EVENTS.map((e) => [e, true])));
    out = await res.json();
  }
  if (!res.ok) {
    return json({ error: out?.error?.description ?? "Razorpay refused the webhook" }, 502);
  }

  return json({
    ok: true,
    created: true,
    webhookId: out.id ?? null,
    url: out.url ?? url,
    events: out.active_events ?? EVENTS,
    secretRotated: true,
  });
});
