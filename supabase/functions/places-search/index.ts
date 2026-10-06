import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";

/**
 * Place search for the app, so no Google key ships in the web bundle or APK.
 *
 * The app used to call Google Places directly with EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
 * which anyone could read out of the bundle and spend (audit F-23). Now:
 *   - signed-in callers only (verify_jwt, then getUser),
 *   - 60 searches per 10 minutes per account (public.take_places_quota),
 *   - the key lives here: an Edge Function secret GOOGLE_MAPS_API_KEY, or a
 *     Vault entry of the same name.
 * With no key set it answers { configured: false } and the app falls back to
 * OpenStreetMap, exactly as it did before a key existed.
 *
 * Same request the app made before: the new Places API (searchText), a field
 * mask of three fields (Google bills per field), up to six results.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const LIMIT = 60;
const WINDOW_MIN = 10;

let vaultKey: string | null = null;

async function mapsKey(admin: ReturnType<typeof createClient>): Promise<string> {
  const fromEnv = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (fromEnv) return fromEnv;
  if (vaultKey !== null) return vaultKey;
  const { data } = await admin.rpc("app_secrets");
  vaultKey = String((data as Record<string, string> | null)?.GOOGLE_MAPS_API_KEY ?? "");
  return vaultKey;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user) return json({ error: "Sign in first" }, 401);

  let body: { q?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const q = String(body.q ?? "").trim();
  if (q.length < 2 || q.length > 120) return json({ configured: true, places: [] });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: within, error: quotaErr } = await admin.rpc("take_places_quota", {
    p_user: who.user.id,
    p_limit: LIMIT,
    p_window_minutes: WINDOW_MIN,
  });
  if (quotaErr) return json({ error: "Try again in a moment" }, 503);
  if (within !== true) return json({ error: "Too many searches. Try again in a few minutes." }, 429);

  const key = await mapsKey(admin);
  if (!key) return json({ configured: false, places: [] });

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery: q, maxResultCount: 6 }),
    });
    if (!res.ok) return json({ configured: true, places: [] });
    const out = (await res.json()) as {
      places?: {
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
      }[];
    };
    const places = (out.places ?? [])
      .map((p) => ({
        label: p.formattedAddress ?? p.displayName?.text ?? q,
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
      }))
      .filter((p) => p.lat !== null && p.lng !== null);
    return json({ configured: true, places });
  } catch {
    // Google unreachable: the app falls through to OpenStreetMap.
    return json({ configured: true, places: [] });
  }
});
