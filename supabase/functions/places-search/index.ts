import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { captureServerError, guarded, logServer } from "../_shared/monitoring.ts";
import { STANDING_REFUSAL, mustRefuse, standingOf } from "../_shared/standing.ts";
import { placesSource } from "../_shared/sendCaps.ts";
import type { Db } from "../api/core.ts";
import { GuestCeiling, GuestLocalLimit, guestAddress, guestNetKey, guestRateKey, isGuestToken } from "../api/guest.ts";
import { answerGuest, guestPlaceAsk, guestPlacesAllowed } from "./guest.ts";

/**
 * Place search for the app, so no Google key ships in the web bundle or APK.
 *
 * The app used to call Google Places directly with EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
 * which anyone could read out of the bundle and spend (audit F-23). Now:
 *   - signed-in callers (verify_jwt, then getUser); guests (the public key with nobody behind it) get
 *     OpenStreetMap only, through handleGuest below, with the limits of ./guest.ts (B100, B145),
 *   - 60 searches per 10 minutes per account (public.take_places_quota),
 *   - a daily cap on billed Google calls per account (150) and in total (3,000), after which the free OpenStreetMap
 *     search answers (public.take_places_daily, migration 153),
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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user) {
    // Guest mode (B100): exactly the project's public key with nobody behind it, recognised as the api does.
    const sentJwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const jwt = sentJwt || (req.headers.get("apikey") === anonKey ? anonKey : "");
    const claims = jwt ? await asCaller.auth.getClaims(jwt).catch(() => null) : null;
    if (jwt && isGuestToken(jwt, anonKey, claims)) return await handleGuest(req, url);
    return json({ error: "Sign in first" }, 401);
  }

  // A suspended or deleted person's token still checks out for up to an hour: refuse it here as the api does (task 2.14, H46).
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const standing = await standingOf(admin, who.user.id);
  if (mustRefuse(standing)) {
    await logServer("warn", "places-search", "refused: " + standing + " account", { user_id: who.user.id });
    return json({ error: STANDING_REFUSAL, code: "UNAUTHENTICATED" }, 401);
  }
  if (standing === null) await logServer("warn", "places-search", "account standing unavailable", { user_id: who.user.id });

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

  // Google bills per call, so each one is counted against a daily cap per person and a daily total (migration 153,
  // finding H39). Past either cap, or if the counter cannot be reached, the free OpenStreetMap search answers instead:
  // the app already accepts that, so nothing breaks and nothing is billed.
  const { data: daily, error: dailyErr } = await admin.rpc("take_places_daily", { p_user: who.user.id });
  if (dailyErr) {
    await logServer("error", "places-search", "daily search cap unavailable", { error: dailyErr.message });
    await captureServerError(new Error(dailyErr.message), { fn: "places-search", step: "take_places_daily" });
  }
  if (placesSource(dailyErr ? null : daily) === "osm") {
    return json({ configured: true, places: await osmSearch(q), source: "osm" });
  }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery: q, maxResultCount: 6 }),
      signal: AbortSignal.timeout(6000),
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
        label: tidy(p.formattedAddress ?? p.displayName?.text ?? q) || q,
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

/** The guests' stand-in limiter while api_guest_spend cannot be reached, and the "all guests are over" minute. */
const guestLocalLimit = new GuestLocalLimit();
const guestCeiling = new GuestCeiling();

/**
 * A guest's place search (B100, B145): OpenStreetMap only, from here, with the typed text capped, the point rounded
 * to about a kilometre and the guest limits of ./guest.ts. Never Google, never the signed-in quotas.
 */
async function handleGuest(req: Request, url: string): Promise<Response> {
  const raw = await req.text().catch(() => "");
  if (raw.length > 2_000) return json({ error: "Bad request" }, 400);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const ask = guestPlaceAsk(body);
  // Nothing worth looking up: the same empty answer a signed-in caller gets, and nothing is counted.
  if (!ask) return json({ configured: true, places: [] });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const address = guestAddress(req.headers);
  const [key, net] = await Promise.all([guestRateKey(address), guestNetKey(address)]);
  const verdict = await guestPlacesAllowed(admin as unknown as Db, key, net, guestLocalLimit, guestCeiling, (why) => {
    void logServer("warn", "places-search", "guest limiter unavailable", { error: why });
  });
  if (verdict === "limited") return json({ error: "Too many searches. Try again in a few minutes." }, 429);
  if (verdict === "busy") return json({ error: "Try again in a moment" }, 503);
  return json(await answerGuest(ask, { search: osmSearch, reverse: osmReverse }));
}

// OpenStreetMap's Nominatim asks every client to identify itself and to stay
// under about one request a second; the per-account budget above keeps us there.
const OSM = { "User-Agent": "TaskDrop/1.0 (support@taskdrop.in)", "Accept-Language": "en" };

/** One space after each comma and no doubled spaces, the same as the app's tidyLabel (B176). */
function tidy(label: string): string {
  return label.split(",").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ");
}

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
        label: tidy(r.display_name?.split(",").slice(0, 3).join(",") ?? "") || r.name || q,
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
    if (!res.ok) {
      await logServer("warn", "places-search", "OpenStreetMap reverse lookup refused", { http_status: res.status });
      return null;
    }
    const out = (await res.json()) as { display_name?: string; name?: string };
    return out.name || tidy(out.display_name?.split(",").slice(0, 3).join(",") ?? "") || null;
  } catch {
    return null;
  }
}
