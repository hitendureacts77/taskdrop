import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";

/**
 * Phone sign-in for TaskDrop.
 *
 * The project has no Supabase SMS provider and anonymous sign-in is disabled,
 * so this function owns the whole phone flow using the service role:
 *   action "send"   -> store a 6-digit code and text it through MSG91
 *   action "verify" -> check it, create/find the user (already confirmed), and
 *                      hand back a magic-link token the client swaps for a real
 *                      session via supabase.auth.verifyOtp().
 *
 * The code is never returned to the caller. This endpoint is public
 * (verify_jwt = false — requiring a session to sign in would be circular), so
 * anything in the response body is readable by anyone who knows a phone number.
 * The one exception is TEST_PHONES, an explicit allowlist for development.
 *
 * Secrets this needs:
 *   MSG91_AUTHKEY      MSG91 auth key
 *   MSG91_TEMPLATE_ID  DLT-approved OTP template id, which must contain ##OTP##
 *   TEST_PHONES        optional, comma-separated 10-digit numbers that skip SMS
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
const SEND_COOLDOWN_SEC = 60;
const SENDS_PER_PHONE_PER_WINDOW = 5;
const SENDS_PER_IP_PER_WINDOW = 30;
const WINDOW_MIN = 60;

const MSG91_AUTHKEY = Deno.env.get("MSG91_AUTHKEY") ?? "";
const MSG91_TEMPLATE_ID = Deno.env.get("MSG91_TEMPLATE_ID") ?? "";

// Development escape hatch: a single fixed code that works for ANY number.
//
// This is a universal account-takeover switch by definition, so it is wired
// with two independent locks and it defaults OFF:
//   1. It only arms when ALLOW_ANY_OTP is explicitly set to "1".
//   2. Even then it refuses to arm if real SMS is configured -- the instant
//      MSG91 is wired up for launch, no flag can turn this back on.
// So on any server that can actually send SMS to real users, this is dead
// code. Never set ALLOW_ANY_OTP on a project that holds real accounts.
const DEV_OTP = "000000";
const DEV_BYPASS =
  (Deno.env.get("ALLOW_ANY_OTP") ?? "") === "1" && !MSG91_AUTHKEY && !MSG91_TEMPLATE_ID;

if (DEV_BYPASS) {
  console.warn(
    `[phone-auth] ALLOW_ANY_OTP is ON: every number is accepted with code ${DEV_OTP}. ` +
      `This is a development-only bypass and must never run against real users.`,
  );
}

function normalise(phone: string): string {
  return String(phone ?? "").replace(/[^0-9]/g, "").slice(-10);
}

const TEST_PHONES = new Set(
  (Deno.env.get("TEST_PHONES") ?? "")
    .split(",")
    .map(normalise)
    .filter((p) => p.length === 10),
);

/** A login code is a credential, so it comes from the CSPRNG, not Math.random. */
function sixDigits(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

/**
 * Is there already an account for this phone-derived email?
 *
 * GoTrue's admin list endpoint takes a filter, which supabase-js does not
 * expose, so this goes over REST. The filter is a partial match, hence the
 * exact comparison afterwards.
 */
async function accountExists(email: string): Promise<boolean> {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const url = new URL(`${Deno.env.get("SUPABASE_URL")}/auth/v1/admin/users`);
  url.searchParams.set("filter", email);
  url.searchParams.set("per_page", "50");

  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Could not check that number (${res.status})`);

  const body = await res.json();
  const users: Array<{ email?: string }> = Array.isArray(body?.users) ? body.users : [];
  return users.some((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
}

/**
 * Hand the code to MSG91. We generate and verify it ourselves, so this uses
 * MSG91 purely as a transport: passing `otp` makes it send our value instead of
 * minting its own.
 */
async function sendSms(phone: string, code: string): Promise<void> {
  // v5/otp takes its parameters on the query string; the JSON body is only for
  // extra template variables, which our template does not have.
  const url = new URL("https://control.msg91.com/api/v5/otp");
  url.searchParams.set("template_id", MSG91_TEMPLATE_ID);
  url.searchParams.set("mobile", `91${phone}`);
  url.searchParams.set("otp", code);

  const res = await fetch(url, {
    method: "POST",
    headers: { authkey: MSG91_AUTHKEY, "Content-Type": "application/json" },
    body: "{}",
  });

  // MSG91 answers 200 with {"type":"error"} for a bad template or a number
  // outside the DLT scrub list, so the status line alone proves nothing.
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.type !== "success") {
    throw new Error(String(body.message ?? `MSG91 refused the send (${res.status})`));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: { action?: string; phone?: string; code?: string; mode?: "signin" | "signup" };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  const phone = normalise(body.phone ?? "");
  if (phone.length !== 10) return json({ error: "Enter a 10-digit mobile number" }, 400);

  const now = Date.now();
  const windowMs = WINDOW_MIN * 60_000;

  // ---- send ---------------------------------------------------------------
  if (body.action === "send") {
    // A number on the allowlist, or the dev bypass, skips the SMS gateway and
    // gets its code back in the response instead of over the air.
    const isTest = TEST_PHONES.has(phone);
    const skipSms = isTest || DEV_BYPASS;

    // Refuse rather than fall back to returning the code. An unconfigured
    // server that answers with the OTP is worse than one that answers "not yet".
    if (!skipSms && (!MSG91_AUTHKEY || !MSG91_TEMPLATE_ID)) {
      return json({ error: "SMS is not set up on this server yet" }, 503);
    }

    // Per-IP budget first: it is the only check that survives an attacker
    // rotating phone numbers, which is the attack that costs real money.
    if (!skipSms) {
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
      const { data: ipRow } = await admin
        .from("auth_send_log")
        .select("sends, window_started_at")
        .eq("ip", ip)
        .maybeSingle();

      const ipFresh = !!ipRow && now - new Date(ipRow.window_started_at).getTime() < windowMs;
      const ipSends = ipFresh ? ipRow!.sends : 0;
      if (ipSends >= SENDS_PER_IP_PER_WINDOW) {
        return json({ error: "Too many codes requested. Try again later." }, 429);
      }

      await admin.from("auth_send_log").upsert(
        {
          ip,
          sends: ipSends + 1,
          window_started_at: ipFresh ? ipRow!.window_started_at : new Date(now).toISOString(),
        },
        { onConflict: "ip" },
      );
    }

    const { data: prior } = await admin
      .from("auth_codes")
      .select("attempts, sends_in_window, window_started_at, last_sent_at")
      .eq("phone", phone)
      .maybeSingle();

    const fresh = !!prior && now - new Date(prior.window_started_at).getTime() < windowMs;

    if (fresh && prior!.last_sent_at) {
      const since = (now - new Date(prior!.last_sent_at).getTime()) / 1000;
      if (since < SEND_COOLDOWN_SEC) {
        const wait = Math.ceil(SEND_COOLDOWN_SEC - since);
        return json({ error: `Wait ${wait}s before asking for another code` }, 429);
      }
    }
    if (fresh && prior!.sends_in_window >= SENDS_PER_PHONE_PER_WINDOW) {
      return json({ error: "Too many codes for this number. Try again in an hour." }, 429);
    }

    // Under the bypass, store the fixed code so the normal verify path matches
    // it with no special-casing downstream.
    const code = DEV_BYPASS ? DEV_OTP : sixDigits();

    const { error } = await admin.from("auth_codes").upsert(
      {
        phone,
        code,
        // The guess budget carries across a resend. Resetting it here is what
        // made MAX_ATTEMPTS bypassable by alternating resend and guess.
        attempts: fresh ? prior!.attempts : 0,
        expires_at: new Date(now + CODE_TTL_MIN * 60_000).toISOString(),
        sends_in_window: fresh ? prior!.sends_in_window + 1 : 1,
        window_started_at: fresh ? prior!.window_started_at : new Date(now).toISOString(),
        last_sent_at: new Date(now).toISOString(),
      },
      { onConflict: "phone" },
    );
    if (error) return json({ error: error.message }, 500);

    if (skipSms) return json({ ok: true, devCode: code });

    // Already counted against the budget above, so a provider outage cannot be
    // used to hammer MSG91 for free.
    try {
      await sendSms(phone, code);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Could not send the SMS" }, 502);
    }

    return json({ ok: true });
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

    // To the server, signing in and signing up are the same exchange. To the
    // person they are not: someone who chose "Sign in" and mistyped a digit
    // should be told no such account exists, not quietly handed a new empty
    // one under the wrong number. So only the sign-up path may create.
    const wantsSignIn = body.mode === "signin";
    const email = `p${phone}@phone.taskdrop.app`;
    let isNew = false;

    // This has to be an explicit lookup. generateLink("magiclink") creates the
    // user when it does not find one -- verified against the live project --
    // so leaning on it to fail for an unknown number silently registers
    // exactly the person we meant to turn away.
    //
    // Checked before the code is burned, so someone who picked the wrong door
    // can switch to sign-up and reuse the code they already have instead of
    // waiting out the resend cooldown.
    if (wantsSignIn && !(await accountExists(email))) {
      return json(
        { error: "No account found for that number. Create one instead.", noAccount: true },
        404,
      );
    }

    // Good code, and we are about to act on it - burn it.
    await admin.from("auth_codes").delete().eq("phone", phone);

    if (!wantsSignIn) {
      // email_confirm skips the confirmation mail that would otherwise block
      // sign-in. An existing user comes back as an "already registered" error,
      // which is how we tell a new account from a returning one.
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomUUID(),
        user_metadata: { display_name: `Tasker ${phone.slice(-4)}`, phone },
      });
      if (created.error && !/already|registered|exists/i.test(created.error.message)) {
        return json({ error: created.error.message }, 500);
      }
      isNew = !created.error;
    }

    // Mint a one-time token the client exchanges for a session.
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) return json({ error: link.error.message }, 500);

    return json({ ok: true, isNew, token_hash: link.data.properties?.hashed_token, email });
  }

  return json({ error: "Unknown action" }, 400);
});
