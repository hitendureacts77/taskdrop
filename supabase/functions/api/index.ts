import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { gatewayHeaders } from "../_shared/gateway.ts";
import { captureServerError } from "../_shared/monitoring.ts";
import { type Db, RATE_LIMITS, rateBucket, runOp } from "./ops.ts";

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
 * RATE_LIMITS). Over it, the answer is 429 and nothing runs.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const refuse = (message: string, code: string, status: number) =>
  json({ ok: false, error: { message, code, details: null } }, status);

Deno.serve(async (req: Request) => {
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
  if (admin) {
    const { data: allowed, error: rateErr } = await admin.rpc("api_rate_hit", {
      p_user: userData.user.id,
      p_bucket: bucket,
      p_limit: RATE_LIMITS[bucket],
    });
    if (rateErr) console.error("api: rate limiter unavailable", rateErr.message);
    else if (allowed === false) {
      return refuse("You are going too fast. Please wait a moment and try again.", "RATE_LIMITED", 429);
    }
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
      console.error(`api: ${name} hand-off failed`, e);
    }
  };

  /** The caller's own folder only, with the service role. Best-effort, like removeMedia. */
  const ownFolder = `${userData.user.id}/`;
  const removeOwnFiles = async (paths: string[]) => {
    const mine = paths.filter((p) => p.startsWith(ownFolder) && !p.includes(".."));
    if (!admin || mine.length === 0) return;
    for (let i = 0; i < mine.length; i += 100) {
      const { error } = await admin.storage.from("task-media").remove(mine.slice(i, i + 100));
      if (error) console.error("api: could not remove files", error.message);
    }
  };

  const ctx = { db: db as unknown as Db, userId: userData.user.id, callFunction, removeOwnFiles };
  const result = await runOp(body.op, body.args, ctx, (e) => {
    console.error(`api: op ${String(body.op)} failed`, e);
    // Finishes in the background after the response is sent.
    const report = captureServerError(e, { op: String(body.op), fn: "api" });
    (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(report);
  });
  return json(result);
});
