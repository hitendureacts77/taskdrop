import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { APP_CHECK_HEADER, AppCheckLog, checkAppCheck } from "../_shared/appCheck.ts";
import { ControlsCache,PLATFORM_HEADER, VERSION_HEADER, parseControls, readClient } from "../_shared/controls.ts";
import { gatewayHeaders } from "../_shared/gateway.ts";
import { configFrom as imageKitConfig } from "../_shared/imagekit.ts";
import { type LogAttributes, captureSecurityEvent, guarded, background, captureServerError, logServer } from "../_shared/monitoring.ts";
import { secret } from "../_shared/secrets.ts";
import { type SessionCutoff, type Standing, StandingCache, callerFromClaims, cutoffOf, endedBefore, standingOf, tokenFacts } from "./core.ts";
import { MAX_BODY_BYTES, REQUEST_ID_HEADER, readBody, requestIdFrom, withGatewayHeaders } from "./http.ts";
import { type Db, RecentlyLimited, batchCalls, rateBucket, rateCost, runBatch, runOp, spendRate } from "./ops.ts";
import { type Claim, type RepeatStore, REPEAT_KEY_HEADER, REPLAYED_HEADER, repeatKeyFrom, runOnce } from "./repeat.ts";
import { PublicMemo } from "./publicMemo.ts";
import { GUEST_READS_PER_MINUTE, guestAddress, guestRateKey, isGuestOp, isGuestToken, needsAccount, runGuestBatch, runGuestOp } from "./guest.ts";

/**
 * The app's one door to its data.
 *
 *   POST /functions/v1/api   { "op": "listOpenTasks", "args": { ... } }
 *   ->  { "ok": true,  "data": ... }
 *   or  { "ok": false, "error": { "message", "code", "details" } }
 *
 * `{ "op": "batch", "args": { "calls": [{ "op", "args" }, ...] } }` runs up to
 * MAX_BATCH reads at once and answers `data: [reply, ...]` in the same order,
 * each reply shaped like the above. Each call counts against the limiter.
 *
 * What each `op` does lives in ./ops.ts and its neighbours, on the server. A
 * refusal (not enough money, quote not allowed) comes back as HTTP 200 with
 * `ok: false`, so the app can tell it apart from a transport failure.
 *
 * Each call runs with the caller's own token, so row level security and the
 * SQL functions' checks apply exactly as they do for a direct request.
 *
 * Each person gets a per-minute budget of reads, writes and uploads (see
 * RATE_LIMITS). Over it, the answer is 429 and nothing is returned. A write
 * never starts; a read may already be running beside the counter (it changes
 * nothing) and its answer is dropped.
 *
 * Every answer carries the call's id (x-request-id, sent by the app or made
 * here) and is never cached; a body over MAX_BODY_BYTES is refused with 413
 * before it is read (see ./http.ts).
 *
 * A write may carry an Idempotency-Key header; the same key sent again gets
 * the first reply back and the write is not done twice (see ./repeat.ts).
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region, " + PLATFORM_HEADER + ", " + VERSION_HEADER + ", " + APP_CHECK_HEADER + ", " + REQUEST_ID_HEADER + ", " + REPEAT_KEY_HEADER,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The operations that sign or check ImageKit pictures. */
const IMAGE_OPS = new Set(["createUpload", "attachMedia", "signMedia"]);

/** The admin panel's switches per platform and version, kept for half a minute per instance. */
const controlsCache = new ControlsCache(30_000);

/**
 * The same-for-everyone answers (plan 3.5b layer D), shared by guests and signed-in callers of this server copy.
 * Used only while the admin switch "public cache: memo" is on (see sharedAnswer). At most once a minute, one log
 * line per op with its hit, miss, shared-wait and not-kept counts: op names and numbers only.
 */
const publicMemo = new PublicMemo({
  report: (op, counts) => background(logServer("info", "api", "memo counts", { op, ...counts })),
});

/** People the limiter refused lately: their reads wait for the limiter instead of running beside it. */
const limitedLately = new RecentlyLimited();

/** Whether a person is suspended or deleted, kept for 5 seconds per instance so a ban still bites quickly. */
const standingCache = new StandingCache(5_000);
/** Same memo, for when a person's sessions were last ended (migration 142). */
const cutoffCache = new StandingCache<SessionCutoff>(5_000);

/** Which App Check results were logged lately, so the log shows who passes without a line per request. */
const appCheckLog = new AppCheckLog();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const refuse = (message: string, code: string, status: number) =>
  json({ ok: false, error: { message, code, details: null } }, status);

/** 200 with { ok: true } when the database answers, 503 otherwise, so a monitor can alert on the status code. */
async function health(url: string): Promise<Response> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let database = false;
  if (serviceKey) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.rpc("get_app_controls", { p_platform: "web", p_version: "0" });
    database = !error;
  }
  return json({ ok: database, data: { status: database ? "ok" : "down", database } }, database ? 200 : 503);
}

Deno.serve(guarded("api", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const requestId = requestIdFrom(req.headers);
  return withGatewayHeaders(await handle(req, requestId), requestId);
}));

/**
 * A guest's call (design D15): someone using the app before making an account. Only the reads in ./guest.ts
 * run, with the service key, through the SQL functions of migration 146, which decide what a guest may see.
 * Anything else answers NEEDS_ACCOUNT. The limiter counts per network address (hashed), not per person.
 */
async function handleGuest(
  req: Request,
  url: string,
  parsed: unknown,
  log: (level: "info" | "warn" | "error", message: string, extra?: LogAttributes) => Promise<void>,
): Promise<Response> {
  if (parsed === undefined) return refuse("Unknown request", "BAD_JSON", 400);
  const body = parsed as { op?: unknown; args?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse("Unknown request", "BAD_JSON", 400);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return refuse("Something went wrong. Please try again.", "INTERNAL", 500);
  const isBatch = body.op === "batch";
  // Nothing a guest cannot do is even counted: the app opens its own pop-up for those.
  const calls = isBatch ? (batchCalls(body.args) ?? []) : [];
  if (!isBatch && !isGuestOp(body.op)) return json(needsAccount());
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const key = await guestRateKey(guestAddress(req.headers));
  try {
    const hit = await admin.rpc("api_rate_spend", {
      p_user: key, p_bucket: "guest", p_limit: GUEST_READS_PER_MINUTE, p_cost: rateCost(body.op, body.args),
    });
    if (hit.error) background(log("warn", "rate limiter unavailable", { error: hit.error.message }));
    else if (hit.data === false) {
      background(log("warn", "guest rate limited", { op: String(body.op) }));
      return refuse("You are going too fast. Please wait a moment and try again.", "RATE_LIMITED", 429);
    }
  } catch (e) {
    background(log("warn", "rate limiter unavailable", { error: e instanceof Error ? e.message : String(e) }));
  }

  const client = readClient(req.headers);
  background((async () => {
    const result = await checkAppCheck(req.headers.get(APP_CHECK_HEADER), await secret("FIREBASE_PROJECT_NUMBER"));
    if (appCheckLog.shouldLog(result, client.platform)) {
      await log(result === "invalid" ? "warn" : "info", "app check", { result, platform: client.platform, op: String(body.op), guest: true });
      if (result === "invalid") await captureSecurityEvent("app_check_failed", "api");
    }
  })().catch(() => {}));
  const controls = await controlsCache.get(client, async () => {
    const { data, error } = await admin.rpc("get_app_controls", { p_platform: client.platform, p_version: client.appVersion });
    if (error) {
      background(log("warn", "app controls unavailable", { error: error.message }));
      return null;
    }
    return parseControls(data);
  });
  const signs = isBatch ? calls.some((c) => c.op === "signMedia") : body.op === "signMedia";
  const imagekit = signs ? await imageKitConfig(secret) : null;
  // No person: the nil id keeps the shared reads' types whole and matches nobody's rows.
  const ctx = { db: admin as unknown as Db, userId: "00000000-0000-0000-0000-000000000000", client, controls, imagekit, memo: publicMemo };
  const onUnexpected = (e: unknown) => {
    background(log("error", "guest op failed", { op: String(body.op), error: e instanceof Error ? e.message : String(e) }));
    background(captureServerError(e, { op: String(body.op), fn: "api", caller: "guest" }));
  };
  return json(await (isBatch ? runGuestBatch(body.args, ctx, onUnexpected) : runGuestOp(body.op, body.args, ctx, onUnexpected)));
}

async function handle(req: Request, requestId: string): Promise<Response> {
  if (req.method !== "POST") return refuse("Unknown request", "BAD_METHOD", 405);
  /** A log line for this call, with its id, so it can be matched to what the person saw. */
  const log = (level: "info" | "warn" | "error", message: string, extra: LogAttributes = {}) =>
    logServer(level, "api", message, { ...extra, request_id: requestId });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  // Signed out, the app's client sends only the public key, in `apikey`, and no Authorization at all: that is a
  // guest (design D15). Exactly the project's public key counts, nothing else.
  const sentJwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const jwt = sentJwt || (anonKey && req.headers.get("apikey") === anonKey ? anonKey : "");
  if (!jwt) return refuse("Sign in first", "UNAUTHENTICATED", 401);

  if (!url || !anonKey) {
    console.error("api: SUPABASE_URL / SUPABASE_ANON_KEY missing", requestId);
    return refuse("Something went wrong. Please try again.", "INTERNAL", 500);
  }

  // The caller's own client: every query below runs as them, under their RLS,
  // and carries the header that lets it past the gateway-only lockdown.
  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}`, ...(await gatewayHeaders()) } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Read once, and no further than MAX_BODY_BYTES: nothing the app sends comes near it.
  const raw = await readBody(req, MAX_BODY_BYTES);
  if (!raw.ok) {
    background(log("warn", "request too large"));
    return refuse("That is too much to send at once.", "TOO_LARGE", 413);
  }
  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    /* answered below, after the sign-in check, as before */
  }
  // Uptime check: { "op": "health" } with the project's anon key as the bearer
  // token (the gateway still wants a valid key). Answers before any sign-in and
  // changes nothing; it only says whether the database answers.
  if (req.headers.get("content-type")?.includes("json") && (parsed as { op?: unknown } | null)?.op === "health") {
    return await health(url);
  }

  // Checked here against the project's cached public keys, not by asking the auth service on every call
  // (P2-48: that round trip was a large part of the function's own time). The gateway has already
  // verified the token (verify_jwt); this reads who it belongs to and that it has not expired.
  // A token that is not even shaped like one makes getClaims throw rather than answer an error: nobody, too.
  const claimsResult = await db.auth.getClaims(jwt).catch(() => null);
  const userId = callerFromClaims(claimsResult);
  const token = tokenFacts(claimsResult);
  // Guest mode (D15): the public key with nobody behind it may read a short list of public things.
  if (!userId && isGuestToken(jwt, anonKey, claimsResult)) return await handleGuest(req, url, parsed, log);
  if (!userId) {
    background(captureSecurityEvent("refused_login", "api"));
    return refuse("Your session has expired. Please sign in again.", "UNAUTHENTICATED", 401);
  }

  if (parsed === undefined) return refuse("Unknown request", "BAD_JSON", 400);
  const body = parsed as { op?: unknown; args?: unknown };
  // `null`, a list or a bare number is valid JSON but not a request (found 2026-10-24: `null` answered 500).
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse("Unknown request", "BAD_JSON", 400);
  const repeatKey = repeatKeyFrom(req.headers);
  if (repeatKey === "bad") return refuse("Unknown request", "BAD_KEY", 400);

  // The counter is written with the service key: a person must not be able to
  // reset or spend anyone else's budget. If the counter cannot be reached the
  // request goes ahead -- an outage of the limiter must not become an outage
  // of the app -- and the failure is logged.
  const bucket = rateBucket(body.op);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = serviceKey
    ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  /** The refusal to send, or null when the call may go ahead. Never rejects. */
  const checkRate = async (): Promise<Response | null> => {
    if (!admin) return null;
    try {
      // A batch counts once per call inside it, so batching never widens the budget: one database call, whole cost.
      const hit = await spendRate(admin, userId, bucket, rateCost(body.op, body.args));
      if (hit.error) {
        background(log("warn", "rate limiter unavailable", { error: hit.error.message }));
        return null;
      }
      if (hit.data === false) {
        limitedLately.mark(userId);
        background(log("warn", "rate limited", { op: String(body.op), bucket, user_id: userId }));
        return refuse("You are going too fast. Please wait a moment and try again.", "RATE_LIMITED", 429);
      }
    } catch (e) {
      background(log("warn", "rate limiter unavailable", { error: e instanceof Error ? e.message : String(e) }));
    }
    return null;
  };
  // Only a read runs while the counter is still being written: it changes
  // nothing, and a refusal drops its answer. A write waits for the counter.
  const overlap = bucket === "read" && !limitedLately.has(userId);
  // Started now, so its round trip overlaps the switches' below (when this
  // instance has to read them) and, for a read, the operation's own.
  const rate = checkRate();
  // A token stays valid after a suspension or a deletion (up to an hour), so the person's standing is read too.
  // Asked now, beside the limiter and the switches, so it adds no round trip of its own to a call.
  const standing = admin
    ? standingCache.get(userId, () => standingOf(admin, userId))
    : Promise.resolve<Standing | null>("ok");
  // Whether this token's session was ended after it was issued (sign out of all devices, a password change, an admin).
  // A token the signature still accepts must not outlive that. Asked beside the standing, so it adds no round trip.
  const cutoff = admin
    ? cutoffCache.get(userId, () => cutoffOf(admin, userId))
    : Promise.resolve<SessionCutoff | null>(null);

  // Which app is asking, and what the admin panel has switched off for it.
  // If the switches cannot be read the request goes ahead (see refusalFor).
  const client = readClient(req.headers);
  // App Check, monitor mode: record whether the request carries a real app's
  // token. Nothing is refused, whatever the answer (the old app sends none).
  background((async () => {
    const result = await checkAppCheck(req.headers.get(APP_CHECK_HEADER), await secret("FIREBASE_PROJECT_NUMBER"));
    if (appCheckLog.shouldLog(result, client.platform)) {
      await log(result === "invalid" ? "warn" : "info", "app check", { result, platform: client.platform, op: String(body.op) });
      if (result === "invalid") await captureSecurityEvent("app_check_failed", "api");
    }
  })().catch(() => {}));
  const controls = await controlsCache.get(client, async () => {
    const { data, error } = await db.rpc("get_app_controls", { p_platform: client.platform, p_version: client.appVersion });
    if (error) {
      background(log("warn", "app controls unavailable", { error: error.message }));
      return null;
    }
    return parseControls(data);
  });
  const accountStanding = await standing;
  if (accountStanding === "suspended" || accountStanding === "deleted") {
    background(log("warn", "refused: " + accountStanding + " account", { op: String(body.op), user_id: userId }));
    return refuse("Your session has expired. Please sign in again.", "UNAUTHENTICATED", 401);
  }
  const sessionCutoff = await cutoff;
  if (endedBefore(sessionCutoff, token)) {
    background(log("info", "refused: session was ended", { op: String(body.op), user_id: userId }));
    return refuse("You were signed out. Please sign in again.", "UNAUTHENTICATED", 401);
  }
  // If standing could not be read the request goes ahead, like an unreachable limiter: an outage of the check
  // must not become an outage of the app (the operation itself still runs under the caller's row level security).
  if (accountStanding === null) background(log("warn", "account standing unavailable", { user_id: userId }));
  if (!overlap) {
    const refused = await rate;
    if (refused) return refused;
  }

  /**
   * Another of our functions, as the caller. Best-effort: a failure here never fails the request.
   * It runs after the answer is sent, so the person is not kept waiting for a second function (a withdrawal
   * request took 0.8 to 1.6 s with the hand-off to RazorpayX in front of the answer; the Phase 5 target is
   * under 1 s). The request itself is already saved, and the hand-off can be repeated by an admin or the sweep.
   */
  const callFunction = (name: string, payload: unknown): Promise<void> => {
    background(handOff(name, payload));
    return Promise.resolve();
  };
  const handOff = async (name: string, payload: unknown) => {
    try {
      // Pinned next to the database, like every call the app makes.
      await fetch(`${url}/functions/v1/${name}?forceFunctionRegion=ap-south-1`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          apikey: anonKey,
          "Content-Type": "application/json",
          "x-region": "ap-south-1",
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      background(log("error", "function hand-off failed", { target: name, error: e instanceof Error ? e.message : String(e) }));
    }
  };

  /** The caller's own folder only, with the service role. Best-effort, like removeMedia. */
  const ownFolder = `${userId}/`;
  const removeOwnFiles = async (paths: string[]) => {
    const mine = paths.filter((p) => p.startsWith(ownFolder) && !p.includes(".."));
    if (!admin || mine.length === 0) return;
    for (let i = 0; i < mine.length; i += 100) {
      const { error } = await admin.storage.from("task-media").remove(mine.slice(i, i + 100));
      if (error) background(log("error", "could not remove files", { error: error.message, user_id: userId }));
    }
  };

  // A confirmed phone number is what "verified" means; Supabase leaves phone_confirmed_at empty otherwise.
  // The token does not say, and only the "phone must be confirmed" switch uses the answer, so the auth
  // service is asked only while that switch is on.
  let phoneVerified: boolean | undefined;
  if (controls?.require_phone_verified) {
    const { data: userData, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userData?.user) return refuse("Your session has expired. Please sign in again.", "UNAUTHENTICATED", 401);
    phoneVerified = Boolean(userData.user.phone_confirmed_at);
  }
  // Only the operations that handle pictures need ImageKit's keys.
  const isBatch = body.op === "batch";
  const needsImageKit = isBatch ? (batchCalls(body.args) ?? []).some((c) => IMAGE_OPS.has(c.op)) : IMAGE_OPS.has(String(body.op));
  const imagekit = needsImageKit ? await imageKitConfig(secret) : null;
  const ctx = { db: db as unknown as Db, userId, callFunction, removeOwnFiles, client, controls, phoneVerified, imagekit, memo: publicMemo };
  const onUnexpected = (e: unknown) => {
    // Both finish in the background after the response is sent.
    background(log("error", "op failed", { op: String(body.op), user_id: userId, error: e instanceof Error ? e.message : String(e) }));
    background(captureServerError(e, { op: String(body.op), fn: "api", request_id: requestId }));
  };
  // A write with a key runs at most once per key; a repeat gets the saved reply (reads never need one).
  if (repeatKey && admin && !isBatch && bucket !== "read") {
    const store: RepeatStore = {
      claim: async (key, op, hash) => {
        const { data, error } = await admin.rpc("api_repeat_claim", { p_user: userId, p_key: key, p_op: op, p_hash: hash });
        if (error) throw new Error(error.message);
        return data as Claim;
      },
      save: async (key, reply) => {
        const { error } = await admin.rpc("api_repeat_save", { p_user: userId, p_key: key, p_reply: reply });
        if (error) throw new Error(error.message);
      },
    };
    const op = String(body.op);
    const out = await runOnce(store, repeatKey, op, body.args ?? {}, () => runOp(body.op, body.args, ctx, onUnexpected), (e) =>
      background(log("warn", "repeat keys unavailable", { op, error: e instanceof Error ? e.message : String(e) })));
    if (out.replayed) background(log("info", "repeat answered from the saved reply", { op, user_id: userId }));
    const res = json(out.reply, out.status);
    if (out.replayed) res.headers.set(REPLAYED_HEADER, "true");
    return res;
  }
  const running = isBatch ? runBatch(body.args, ctx, onUnexpected) : runOp(body.op, body.args, ctx, onUnexpected);
  if (!overlap) return json(await running);
  const [refused, result] = await Promise.all([rate, running]);
  return refused ?? json(result);
}
