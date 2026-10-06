import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";

/**
 * Username + password sign-in.
 *
 * TaskDrop accounts are created by phone OTP (email p<phone>@phone.taskdrop.app)
 * or Google, so a person never learns the email their account sits on. Once
 * they set a password (Settings -> Security, supabase.auth.updateUser) they can
 * sign in with their public @username instead: this function resolves the
 * username to the account server-side, signs in with the anon key exactly as
 * the client would, and hands back the session for supabase.auth.setSession().
 *
 * The account email is never returned, so a username cannot be turned into a
 * phone number. Failed attempts are throttled per username and per IP, over
 * 15 minutes and over a day, by password_sign_in_gate() (migration 088); when
 * the gate cannot be reached the attempt is refused, never waved through. The
 * owner is notified when their username locks (record_password_attempt).
 *
 * Public endpoint (verify_jwt = false): signing in cannot require a session.
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

// One sentence for every failure that is the caller's fault, so the response
// never reveals whether a username exists.
const WRONG = "That username and password do not match";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const username = String(body.username ?? "").trim().replace(/^@/, "").toLowerCase();
  const password = String(body.password ?? "");
  if (!/^[a-z0-9_]{3,20}$/.test(username) || password.length < 1) {
    return json({ error: WRONG }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  // cf-connecting-ip cannot be forged (Cloudflare rejects a request that sets
  // it); the platform rewrites x-forwarded-for, whose first entry is the
  // fallback. true-client-ip / forwarded pass through from the caller: never
  // trust them (verified against this project, audit F-08).
  const ip =
    (req.headers.get("cf-connecting-ip") ?? "").trim() ||
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    null;

  // Fail closed: if the counter cannot be read, no password is tried.
  const { data: waitMin, error: gateErr } = await admin.rpc("password_sign_in_gate", {
    p_username: username,
    p_ip: ip,
  });
  if (gateErr) {
    console.error("password-auth: gate unavailable", gateErr.message);
    return json({ error: "Sign-in is busy. Try again in a minute." }, 503);
  }
  if (typeof waitMin === "number" && waitMin > 0) {
    const wait = waitMin >= 60 ? `${Math.round(waitMin / 60)} hours` : `${waitMin} minutes`;
    return json({ error: `Too many attempts. Try again in ${wait}, or sign in with your phone number.` }, 429);
  }

  const record = (ok: boolean) =>
    admin.rpc("record_password_attempt", { p_username: username, p_ip: ip, p_ok: ok }).then(
      ({ error }) => { if (error) console.error("password-auth: could not record attempt", error.message); },
      () => {},
    );

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (!profile) {
    await record(false);
    return json({ error: WRONG }, 401);
  }

  const { data: found, error: lookupErr } = await admin.auth.admin.getUserById(profile.id);
  const email = found?.user?.email;
  if (lookupErr || !email) {
    await record(false);
    return json({ error: WRONG }, 401);
  }

  // Sign in as the client would, with the anon key, so GoTrue applies its own
  // checks (banned users, unconfirmed emails) exactly as for any sign-in.
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: signedIn, error: signInErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !signedIn.session) {
    await record(false);
    return json({ error: WRONG }, 401);
  }

  await record(true);
  return json({
    access_token: signedIn.session.access_token,
    refresh_token: signedIn.session.refresh_token,
  });
});
