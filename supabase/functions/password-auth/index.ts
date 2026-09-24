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
 * phone number. Failed attempts are throttled per username and per IP in
 * password_attempts (deny-all, service role only).
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

const WINDOW_MIN = 15;
const FAILS_PER_USERNAME = 8;
const FAILS_PER_IP = 40;

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
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;

  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const [byName, byIp] = await Promise.all([
    admin.from("password_attempts").select("id", { count: "exact", head: true })
      .eq("username", username).eq("ok", false).gte("at", since),
    ip
      ? admin.from("password_attempts").select("id", { count: "exact", head: true })
          .eq("ip", ip).eq("ok", false).gte("at", since)
      : Promise.resolve({ count: 0 }),
  ]);
  if ((byName.count ?? 0) >= FAILS_PER_USERNAME || (byIp.count ?? 0) >= FAILS_PER_IP) {
    return json({ error: `Too many attempts. Try again in ${WINDOW_MIN} minutes.` }, 429);
  }

  const record = (ok: boolean) =>
    admin.from("password_attempts").insert({ username, ip, ok }).then(() => {}, () => {});

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
