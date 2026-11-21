import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { background, captureSecurityEvent, captureServerError, guarded, logServer } from "../_shared/monitoring.ts";
import { signInRefusal } from "../_shared/signInSwitches.ts";
import { secretKey, signInKey } from "../_shared/forwardedFor.ts";
import { freshNonPasswordSignIn, passwordProblem, tokenAmr } from "../_shared/passwordRules.ts";

/**
 * Username + password sign-in.
 *
 * TaskDrop accounts are created by phone OTP (email p<phone>@phone.taskdrop.app)
 * or Google, so a person never learns the email their account sits on. Once
 * they set a password (Settings -> Security, supabase.auth.updateUser) they can
 * sign in with their public @username instead: this function resolves the
 * username to the account server-side, signs in exactly as the client would
 * (with the person's address forwarded, task 2.8b), and hands back the session
 * for supabase.auth.setSession().
 *
 * The account email is never returned, so a username cannot be turned into a
 * phone number. Failed attempts are throttled per username and per IP, over
 * 15 minutes and over a day, by password_sign_in_gate() (migration 088); when
 * the gate cannot be reached the attempt is refused, never waved through. The
 * owner is notified when their username locks (record_password_attempt).
 *
 * Public endpoint (verify_jwt = false): signing in cannot require a session.
 *
 * Setting or changing the password (hole H30, OWASP ASVS 2.1.1, 2.1.6, 2.1.8, 2.2.3) is
 * `{ action: "change", new_password, current_password? }` with the person's session in
 * Authorization. The new password must pass passwordRules.ts (12 characters and more). Once
 * the person has a password of their own, the current one is needed, unless they signed in
 * by text code or Google in the last 15 minutes: that is the forgotten-password path. Wrong
 * current passwords count towards the same lock as sign-in. After a change the person gets a
 * security notice. Supabase's own "require current password" setting is on as well, so the
 * app cannot skip this door by calling updateUser itself (accounts made by phone code hold a
 * random password nobody knows; this function changes it with the service key). Supabase then
 * ends every session, so the function signs the asking device back in and returns its new session.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-taskdrop-platform, x-taskdrop-app-version",
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

Deno.serve(guarded("password-auth", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  if (body.action === "change") return await changePassword(req, body);

  const username = String(body.username ?? "").trim().replace(/^@/, "").toLowerCase();
  const password = String(body.password ?? "");
  if (!/^[a-z0-9_]{3,20}$/.test(username) || password.length < 1) {
    return json({ error: WRONG }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  // The admin panel's password sign-in switch (migration 092).
  const refused = await signInRefusal(admin, req.headers, "password");
  if (refused) return json({ error: refused, switchedOff: true }, 403);

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
    background(logServer("error", "password-auth", "sign-in gate unavailable", { error: gateErr.message }));
    background(captureServerError(new Error(gateErr.message), { fn: "password-auth", step: "sign_in_gate" }));
    return json({ error: "Sign-in is busy. Try again in a minute." }, 503);
  }
  if (typeof waitMin === "number" && waitMin > 0) {
    // Someone is guessing passwords; the username stays out of the log.
    background(logServer("warn", "password-auth", "locked out after too many attempts", { wait_minutes: waitMin }));
    const wait = waitMin >= 60 ? `${Math.round(waitMin / 60)} hours` : `${waitMin} minutes`;
    return json({ error: `Too many attempts. Try again in ${wait}, or sign in with your phone number.` }, 429);
  }

  const record = (ok: boolean) => {
    if (!ok) background(captureSecurityEvent("refused_login", "password-auth"));
    return recordAttempt(ok);
  };
  const recordAttempt = (ok: boolean) =>
    admin.rpc("record_password_attempt", { p_username: username, p_ip: ip, p_ok: ok }).then(
      ({ error }) => { if (error) background(logServer("error", "password-auth", "could not record attempt", { error: error.message })); },
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

  // Sign in as the client would, so GoTrue applies its own checks (banned users,
  // unconfirmed emails) exactly as for any sign-in. With the secret key and the
  // person's address in Sb-Forwarded-For, GoTrue's per-address limit counts this
  // person, not this server (task 2.8b); without a secret key it is the anon key.
  const { key, headers } = signInKey(ip, secretKey(Deno.env.get("SUPABASE_SECRET_KEYS")), Deno.env.get("SUPABASE_ANON_KEY")!);
  const signer = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers },
  });
  const { data: signedIn, error: signInErr } = await signer.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr?.status === 429) {
    // GoTrue's own limit, not a wrong password: say so, and do not count it as a failed try.
    background(logServer("warn", "password-auth", "auth rate limit reached", { forwarded: "sb-forwarded-for" in headers }));
    return json({ error: "Too many tries. Please wait a minute and try again." }, 429);
  }
  if (signInErr || !signedIn.session) {
    // A closed account is refused by GoTrue only once the password is right, so saying so
    // gives nothing away about who has an account.
    if (signInErr?.code === "user_banned") {
      return json({ error: "This account is closed. Contact support." }, 403);
    }
    await record(false);
    return json({ error: WRONG }, 401);
  }

  await record(true);
  return json({
    access_token: signedIn.session.access_token,
    refresh_token: signedIn.session.refresh_token,
  });
}));

/** The caller's address, read the same way as for sign-in (see above). */
function callerIp(req: Request): string | null {
  return (
    (req.headers.get("cf-connecting-ip") ?? "").trim() ||
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    null
  );
}

/** Set or change the signed-in person's password (H30). See the header comment for the rules. */
async function changePassword(req: Request, body: Record<string, unknown>): Promise<Response> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Sign in first." }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const refused = await signInRefusal(admin, req.headers, "password");
  if (refused) return json({ error: refused, switchedOff: true }, 403);

  const { data: got, error: userErr } = await admin.auth.getUser(jwt);
  const user = got?.user;
  if (userErr || !user?.email) return json({ error: "Sign in again, then try once more." }, 401);

  const { data: profile } = await admin
    .from("profiles")
    .select("username, deleted_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.deleted_at) return json({ error: "Sign in again, then try once more." }, 401);
  const username = String(profile.username ?? "");
  if (!username) return json({ error: "Pick a username first. It is what you sign in with." }, 400);

  const next = String(body.new_password ?? "");
  const current = String(body.current_password ?? "");
  const problem = passwordProblem(next, username);
  if (problem) return json({ error: problem }, 400);

  // Does the person already have a password of their own? Accounts made by text code hold a random one
  // nobody knows. password_set_at is written below; accounts that set a password before it existed are
  // found by a successful password sign-in.
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  let hasOwn = typeof meta.password_set_at === "string";
  if (!hasOwn) {
    const { data: ok } = await admin
      .from("password_attempts")
      .select("ok")
      .eq("username", username)
      .eq("ok", true)
      .limit(1);
    hasOwn = Boolean(ok?.length);
  }

  const ip = callerIp(req);
  const fresh = freshNonPasswordSignIn(tokenAmr(jwt), Math.floor(Date.now() / 1000));
  if (hasOwn && !fresh) {
    if (!current) {
      return json({ error: "Enter your current password.", needCurrent: true }, 400);
    }
    // The same lock as sign-in: someone with an open session cannot guess the old password for ever.
    const { data: waitMin, error: gateErr } = await admin.rpc("password_sign_in_gate", { p_username: username, p_ip: ip });
    if (gateErr) {
      background(captureServerError(new Error(gateErr.message), { fn: "password-auth", step: "change_gate" }));
      return json({ error: "Busy. Try again in a minute." }, 503);
    }
    if (typeof waitMin === "number" && waitMin > 0) {
      return json({
        error: "Too many wrong passwords. Sign in again with your mobile number, then set a new password within 15 minutes.",
        needCurrent: true,
      }, 429);
    }
    const { key, headers } = signInKey(ip, secretKey(Deno.env.get("SUPABASE_SECRET_KEYS")), Deno.env.get("SUPABASE_ANON_KEY")!);
    const signer = createClient(url, key, { auth: { persistSession: false }, global: { headers } });
    const { data: proof, error: proofErr } = await signer.auth.signInWithPassword({ email: user.email, password: current });
    if (proofErr?.status === 429) return json({ error: "Too many tries. Please wait a minute and try again." }, 429);
    if (proofErr || !proof.session) {
      background(captureSecurityEvent("refused_login", "password-auth"));
      await admin.rpc("record_password_attempt", { p_username: username, p_ip: ip, p_ok: false }).then(() => {}, () => {});
      return json({ error: "That is not your current password.", needCurrent: true }, 401);
    }
    // The check made a session of its own; end it so it is not left signed in somewhere.
    background(admin.auth.admin.signOut(proof.session.access_token, "local").then(() => {}, () => {}));
    if (current === next) return json({ error: "Choose a password different from the current one." }, 400);
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
    password: next,
    app_metadata: { ...meta, password_set_at: new Date().toISOString() },
  });
  if (updErr) {
    if (updErr.code === "weak_password") return json({ error: "Choose a stronger password." }, 400);
    background(captureServerError(new Error(updErr.message), { fn: "password-auth", step: "change_update" }));
    return json({ error: "Could not set the password. Try again." }, 500);
  }

  // ASVS 2.2.3: tell the person. The plain line suits a locked screen (decision 26).
  const { error: noteErr } = await admin.from("notifications").insert({
    user_id: user.id,
    kind: "security",
    title: hasOwn ? "Your password was changed" : "A password was set on your account",
    body: "Not you? Sign in with your mobile number, set a new password and sign out of all devices.",
  });
  if (noteErr) background(logServer("error", "password-auth", "could not send the change notice", { error: noteErr.message }));
  background(logServer("info", "password-auth", hasOwn ? "password changed" : "password set", { fresh }));

  // Supabase ends EVERY session when the service key changes a password, the device asking included.
  // Sign this device straight back in with the new password and hand it the session, so only the
  // other devices are signed out (as before H30). If that fails the password is still set: the app
  // then asks the person to sign in again.
  const { key: k2, headers: h2 } = signInKey(ip, secretKey(Deno.env.get("SUPABASE_SECRET_KEYS")), Deno.env.get("SUPABASE_ANON_KEY")!);
  const again = createClient(url, k2, { auth: { persistSession: false }, global: { headers: h2 } });
  const { data: back, error: backErr } = await again.auth.signInWithPassword({ email: user.email, password: next });
  if (backErr || !back.session) {
    background(logServer("warn", "password-auth", "could not sign the device back in after a change", { error: backErr?.message ?? "no session" }));
    return json({ ok: true, signedOut: true });
  }
  return json({ ok: true, access_token: back.session.access_token, refresh_token: back.session.refresh_token });
}
