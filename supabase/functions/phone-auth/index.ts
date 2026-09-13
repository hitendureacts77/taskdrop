import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Phone sign-in for TaskDrop.
 *
 * The project has no SMS provider and anonymous sign-in is disabled, so this
 * function owns the whole phone flow using the service role:
 *   action "send"   -> store a 6-digit code for the number
 *   action "verify" -> check it, create/find the user (already confirmed), and
 *                      hand back a magic-link token the client swaps for a real
 *                      session via supabase.auth.verifyOtp().
 *
 * Because there is no SMS gateway, "send" returns the code so the app's Autofill
 * button can surface it. Swap that for a real SMS send before going live.
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

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

function normalise(phone: string): string {
  return String(phone ?? "").replace(/[^0-9]/g, "").slice(-10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: { action?: string; phone?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  const phone = normalise(body.phone ?? "");
  if (phone.length !== 10) return json({ error: "Enter a 10-digit mobile number" }, 400);

  // ---- send ---------------------------------------------------------------
  if (body.action === "send") {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();

    const { error } = await admin
      .from("auth_codes")
      .upsert({ phone, code, attempts: 0, expires_at: expires }, { onConflict: "phone" });
    if (error) return json({ error: error.message }, 500);

    // No SMS gateway yet -> hand the code back so Autofill can use it.
    return json({ ok: true, devCode: code });
  }

  // ---- verify -------------------------------------------------------------
  if (body.action === "verify") {
    const code = String(body.code ?? "").replace(/[^0-9]/g, "");

    const { data: row, error: readErr } = await admin
      .from("auth_codes")
      .select("code, attempts, expires_at")
      .eq("phone", phone)
      .maybeSingle();
    if (readErr) return json({ error: readErr.message }, 500);
    if (!row) return json({ error: "Request a code first" }, 400);

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await admin.from("auth_codes").delete().eq("phone", phone);
      return json({ error: "That code expired. Request a new one." }, 400);
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await admin.from("auth_codes").delete().eq("phone", phone);
      return json({ error: "Too many attempts. Request a new code." }, 429);
    }
    if (row.code !== code) {
      await admin.from("auth_codes").update({ attempts: row.attempts + 1 }).eq("phone", phone);
      return json({ error: "That code is not right" }, 400);
    }

    // Code is good - burn it.
    await admin.from("auth_codes").delete().eq("phone", phone);

    // Create the user if new. email_confirm skips the confirmation mail that
    // would otherwise block sign-in. Existing users fall through harmlessly.
    const email = `p${phone}@phone.taskdrop.app`;
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: crypto.randomUUID(),
      user_metadata: { display_name: `Tasker ${phone.slice(-4)}`, phone },
    });
    if (created.error && !/already|registered|exists/i.test(created.error.message)) {
      return json({ error: created.error.message }, 500);
    }

    // Mint a one-time token the client exchanges for a session.
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) return json({ error: link.error.message }, 500);

    return json({ ok: true, token_hash: link.data.properties?.hashed_token, email });
  }

  return json({ error: "Unknown action" }, 400);
});
