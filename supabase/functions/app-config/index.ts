import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import {
  CONFIG_TTL_SECONDS, type Client, ControlsCache, OPEN_CONFIG, PLATFORM_HEADER, VERSION_HEADER,
  parseControls, publicConfig, readClient,
} from "../_shared/controls.ts";
import { gatewayHeaders } from "../_shared/gateway.ts";
import { captureServerError } from "../_shared/monitoring.ts";

/**
 * What the admin panel has switched for the app that is asking.
 *
 *   GET /functions/v1/app-config?platform=android&version=1.2.0
 *   (or the x-taskdrop-platform / x-taskdrop-app-version headers)
 *   ->  { platform, appVersion, maintenance, update, features, banner, ttlSeconds }
 *
 * Public on purpose: the app asks before anyone has signed in (maintenance and
 * "update the app" must show on the sign-in screen too), and nothing here is
 * secret. The merge of the "all" row and the platform's own row happens in SQL
 * (get_app_controls). The answer is kept about a minute, here and by the
 * caller. If the switches cannot be read the answer is "everything on": an
 * outage of the switches must not become an outage of the app.
 *
 * The api function enforces the same switches on every call, so hiding a
 * button in the app is a courtesy, not the control.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region, " +
    PLATFORM_HEADER + ", " + VERSION_HEADER,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const reply = (body: unknown, cache: string, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    // The answer depends on who asks, so a shared cache must key on these headers too.
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache, Vary: PLATFORM_HEADER + ", " + VERSION_HEADER },
  });

const cache = new ControlsCache(CONFIG_TTL_SECONDS * 1000);

function clientOf(req: Request): Client {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  // The query wins when both are given: it is what a browser can always send without a preflight.
  for (const [param, header] of [["platform", PLATFORM_HEADER], ["version", VERSION_HEADER]] as const) {
    const v = url.searchParams.get(param);
    if (v) headers.set(header, v);
  }
  return readClient(headers);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return reply({ error: "Unknown request" }, "no-store", 405);

  const client = clientOf(req);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    console.error("app-config: SUPABASE_URL / SUPABASE_ANON_KEY missing");
    return reply(OPEN_CONFIG, "no-store");
  }

  const controls = await cache.get(client, async () => {
    const db = createClient(url, anonKey, {
      global: { headers: await gatewayHeaders() },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.rpc("get_app_controls", { p_platform: client.platform, p_version: client.appVersion });
    if (error) {
      console.error("app-config: controls unavailable", error.message);
      const report = captureServerError(new Error(error.message), { fn: "app-config" });
      (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(report);
      return null;
    }
    return parseControls(data);
  });

  if (!controls) return reply({ ...OPEN_CONFIG, platform: client.platform, appVersion: client.appVersion }, "no-store");
  return reply(publicConfig(controls, client), `public, max-age=${CONFIG_TTL_SECONDS}`);
});
