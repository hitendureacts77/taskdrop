import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { captureServerError, guarded, logServer } from "../_shared/monitoring.ts";

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

Deno.serve(guarded("places-search", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user) return json({ error: "Sign in first" }, 401);

  let body: { q?: unknown; lat?: unknown; lng?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  // Two questions: "where is this text" ({ q }) and "what is here" ({ lat, lng }).
  const lat = typeof body.lat === "number" ? body.lat : NaN;
  const lng = typeof body.lng === "number" ? body.lng : NaN;
  const reverse = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const q = String(body.q ?? "").trim();
  if (!reverse && (q.length < 2 || q.length > 120)) return json({ configured: true, places: [] });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: within, error: quotaErr } = await admin.rpc("take_places_quota", {
    p_user: who.user.id,
    p_limit: LIMIT,
    p_window_minutes: WINDOW_MIN,
  });
  if (quotaErr) {
    await logServer("error", "places-search", "search budget unavailable", { error: quotaErr.message });
    await captureServerError(new Error(quotaErr.message), { fn: "places-search", step: "take_places_quota" });
    return json({ error: "Try again in a moment" }, 503);
  }
  if (within !== true) return json({ error: "Too many searches. Try again in a few minutes." }, 429);

  if (reverse) return json({ label: await osmReverse(lat, lng) });

  const key = await mapsKey(admin);
  // No Google key, or Google has nothing: OpenStreetMap answers, from here, so
  // the app does not have to call it (it refuses anonymous app traffic).
  if (!key) return json({ configured: false, places: await osmSearch(q), source: "osm" });

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
    if (!res.ok) {
      // A rejected key or an exhausted quota shows up here first.
      await logServer("error", "places-search", "Google rejected the search", { http_status: res.status });
      return json({ configured: true, places: await osmSearch(q), source: "osm" });
    }
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
    if (places.length) return json({ configured: true, places, source: "google" });
    return json({ configured: true, places: await osmSearch(q), source: "osm" });
  } catch (e) {
    // Google unreachable: fall back to OpenStreetMap.
    await logServer("warn", "places-search", "Google unreachable", { error: e instanceof Error ? e.message : String(e) });
    return json({ configured: true, places: await osmSearch(q), source: "osm" });
  }
}));

// OpenStreetMap's Nominatim asks every client to identify itself and to stay
// under about one request a second; the per-account budget above keeps us there.
const OSM = { "User-Agent": "TaskDrop/1.0 (support@taskdrop.in)", "Accept-Language": "en" };

async function osmSearch(q: string): Promise<{ label: string; lat: number; lng: number }[]> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in&q=${encodeURIComponent(q)}`, {
      headers: OSM,
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      await logServer("warn", "places-search", "OpenStreetMap search refused", { http_status: res.status });
      return [];
    }
    const list = (await res.json()) as { display_name?: string; name?: string; lat?: string; lon?: string }[];
    return list
      .map((r) => ({
        // The full display_name is a mouthful; the first few parts read like an address.
        label: r.display_name?.split(",").slice(0, 3).join(",").trim() || r.name || q,
        lat: Number(r.lat),
        lng: Number(r.lon),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  } catch (e) {
    await logServer("warn", "places-search", "OpenStreetMap unreachable", { error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/** A short name for a point (an area, not a door), or null when there is none. */
async function osmReverse(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lng}`, {
      headers: OSM,
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as { display_name?: string; name?: string };
    return out.name || out.display_name?.split(",").slice(0, 3).join(",").trim() || null;
  } catch {
    return null;
  }
}
