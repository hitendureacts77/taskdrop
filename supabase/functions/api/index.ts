import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { ControlsCache, PLATFORM_HEADER, VERSION_HEADER, parseControls, readClient } from "../_shared/controls.ts";
import { gatewayHeaders } from "../_shared/gateway.ts";
import { configFrom as imageKitConfig } from "../_shared/imagekit.ts";
import { guarded, background, captureServerError, logServer } from "../_shared/monitoring.ts";
import { secret } from "../_shared/secrets.ts";
import { type Db, RATE_LIMITS, RecentlyLimited, rateBucket, runOp } from "./ops.ts";

/**
 * The app's one door to its data.
 *
 *   POST /functions/v1/api   { "op": "listOpenTasks", "args": { ... } }
 *   ->  { "ok": true,  "data": ... }
 *   or  { "ok": false, "error": { "message", "code", "details" } }
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
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region, " + PLATFORM_HEADER + ", " + VERSION_HEADER,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The operations that sign or check ImageKit pictures. */
const IMAGE_OPS = new Set(["createUpload", "attachMedia", "signMedia"]);

/** The admin panel's switches per platform and version, kept for half a minute per instance. */
const controlsCache = new ControlsCache(30_000);

/** People the limiter refused lately: their reads wait for the limiter instead of running beside it. */
const limitedLately = new RecentlyLimited();

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
  if (req.method !== "POST") return refuse("Unknown request", "BAD_METHOD", 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return refuse("Sign in first", "UNAUTHENTICATED", 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    console.error("api: SUPABASE_URL / SUPABASE_ANON_KEY missing");
    return refuse("Something went wrong. Please try again.", "INTERNAL", 500);
  }

  // The caller's own client: every query below runs as them, under their RLS,
  // and carries the header that lets it past the gateway-only lockdown.
  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}`, ...(await gatewayHeaders()) } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Uptime check: { "op": "health" } with the project's anon key as the bearer
  // token (the gateway still wants a valid key). Answers before any sign-in and
  // changes nothing; it only says whether the database answers.
  if (req.headers.get("content-type")?.includes("json")) {
    const peek = (await req.clone().json().catch(() => null)) as { op?: unknown } | null;
    if (peek?.op === "health") return await health(url);
  }

  const { data: userData, error: userErr } = await db.auth.getUser(jwt);
  if (userErr || !userData?.user) return refuse("Your session has expired. Please sign in again.", "UNAUTHENTICATED", 401);

  let body: { op?: unknown; args?: unknown };
  try {
    body = await req.json();
  } catch {
    return refuse("Unknown request", "BAD_JSON", 400);
  }

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
      const { data: allowed, error: rateErr } = await admin.rpc("api_rate_hit", {
        p_user: userData.user.id,
        p_bucket: bucket,
        p_limit: RATE_LIMITS[bucket],
      });
      if (rateErr) {
        background(logServer("warn", "api", "rate limiter unavailable", { error: rateErr.message }));
        return null;
      }
      if (allowed === false) {
        limitedLately.mark(userData.user.id);
        background(logServer("warn", "api", "rate limited", { op: String(body.op), bucket, user_id: userData.user.id }));
        return refuse("You are going too fast. Please wait a moment and try again.", "RATE_LIMITED", 429);
      }
    } catch (e) {
      background(logServer("warn", "api", "rate limiter unavailable", { error: e instanceof Error ? e.message : String(e) }));
    }
    return null;
  };
  // Only a read runs while the counter is still being written: it changes
  // nothing, and a refusal drops its answer. A write waits for the counter.
  const overlap = bucket === "read" && !limitedLately.has(userData.user.id);
  // Started now, so its round trip overlaps the switches' below (when this
  // instance has to read them) and, for a read, the operation's own.
  const rate = checkRate();

  // Which app is asking, and what the admin panel has switched off for it.
  // If the switches cannot be read the request goes ahead (see refusalFor).
  const client = readClient(req.headers);
  const controls = await controlsCache.get(client, async () => {
    const { data, error } = await db.rpc("get_app_controls", { p_platform: client.platform, p_version: client.appVersion });
    if (error) {
      background(logServer("warn", "api", "app controls unavailable", { error: error.message }));
      return null;
    }
    return parseControls(data);
  });
  if (!overlap) {
    const refused = await rate;
    if (refused) return refused;
  }

  /** Another of our functions, as the caller. Best-effort: a failure here never fails the request. */
  const callFunction = async (name: string, payload: unknown) => {
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
      background(logServer("error", "api", "function hand-off failed", { target: name, error: e instanceof Error ? e.message : String(e) }));
    }
  };

  /** The caller's own folder only, with the service role. Best-effort, like removeMedia. */
  const ownFolder = `${userData.user.id}/`;
  const removeOwnFiles = async (paths: string[]) => {
    const mine = paths.filter((p) => p.startsWith(ownFolder) && !p.includes(".."));
    if (!admin || mine.length === 0) return;
    for (let i = 0; i < mine.length; i += 100) {
      const { error } = await admin.storage.from("task-media").remove(mine.slice(i, i + 100));
      if (error) background(logServer("error", "api", "could not remove files", { error: error.message, user_id: userData.user.id }));
    }
  };

  // A confirmed phone number is what "verified" means; Supabase leaves phone_confirmed_at empty otherwise.
  const phoneVerified = Boolean(userData.user.phone_confirmed_at);
  // Only the operations that handle pictures need ImageKit's keys.
  const imagekit = IMAGE_OPS.has(String(body.op)) ? await imageKitConfig(secret) : null;
  const ctx = { db: db as unknown as Db, userId: userData.user.id, callFunction, removeOwnFiles, client, controls, phoneVerified, imagekit };
  const running = runOp(body.op, body.args, ctx, (e) => {
    // Both finish in the background after the response is sent.
    background(logServer("error", "api", "op failed", { op: String(body.op), user_id: userData.user.id, error: e instanceof Error ? e.message : String(e) }));
    background(captureServerError(e, { op: String(body.op), fn: "api" }));
  });
  if (!overlap) return json(await running);
  const [refused, result] = await Promise.all([rate, running]);
  return refused ?? json(result);
}));
