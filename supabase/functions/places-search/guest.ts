/**
 * Place search for guests (B100, B145): someone using the app before making an account.
 *
 * A guest has no session, so the signed-in path (getUser, the per-account quota, Google) cannot run. Before this,
 * places-search answered 401 and the browser asked OpenStreetMap itself, sending what was typed and the real GPS
 * point to a third party. Now a guest is answered here, with less than a signed-in caller gets:
 *   - only OpenStreetMap, from this server (no billed Google call: there is no account to count it against);
 *   - a typed text of at most GUEST_Q_MAX characters;
 *   - a "what is here" point rounded to two decimals (about a kilometre) before it leaves for OpenStreetMap;
 *   - the api's own guest limiter (api_guest_spend: per address, per network, all guests together), at a heavy
 *     cost, so it fails bounded (GuestLocalLimit gives light reads only, and a place search is never light);
 *   - and two counters of its own (api_rate_hit, no new table): per address, and for all guests together, which
 *     keeps the whole of guest traffic inside OpenStreetMap's "about one request a second". Both fail closed.
 *
 * No Deno imports on purpose, so the tests run from Node.
 */

import type { Db } from "../api/core.ts";
import { type GuestCeiling, type GuestLocalLimit, guestSpend } from "../api/guest.ts";

/** Longest typed text a guest may search for. */
export const GUEST_Q_MAX = 80;
/** What one guest place search costs against the api's guest budget (240 a minute per address). */
export const GUEST_PLACE_COST = 10;
/** Guest place searches per address per minute (bucket places_guest). */
export const GUEST_PLACES_PER_MINUTE = 10;
/** Guest place searches per minute for all guests together (bucket places_guest_all): under one a second. */
export const GUEST_PLACES_ALL_PER_MINUTE = 50;
/** The counter key every guest shares for the all-guests bucket. */
export const ALL_GUESTS_KEY = "00000000-0000-0000-0000-000000000000";

export type GuestPlaceAsk = { q: string } | { lat: number; lng: number };

/** Two decimals of a degree, about a kilometre: an area, never a door. */
export const roundForGuest = (x: number): number => Math.round(x * 100) / 100;

/**
 * What a guest asked, checked: a point (rounded) or a text of 2 to GUEST_Q_MAX characters. Null for anything else,
 * which is answered with an empty list and costs nothing.
 */
export function guestPlaceAsk(body: unknown): GuestPlaceAsk | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as { q?: unknown; lat?: unknown; lng?: unknown };
  if (typeof b.lat === "number" && typeof b.lng === "number" && Number.isFinite(b.lat) && Number.isFinite(b.lng)) {
    if (Math.abs(b.lat) > 90 || Math.abs(b.lng) > 180) return null;
    return { lat: roundForGuest(b.lat), lng: roundForGuest(b.lng) };
  }
  if (typeof b.q !== "string") return null;
  const q = b.q.trim();
  if (q.length < 2 || q.length > GUEST_Q_MAX) return null;
  return { q };
}

export type OsmLookups = {
  search: (q: string) => Promise<{ label: string; lat: number; lng: number; via?: string }[]>;
  reverse: (lat: number, lng: number) => Promise<string | null>;
};

/** The reply to an allowed guest ask, from OpenStreetMap only, in the shapes the signed-in path answers. */
export async function answerGuest(ask: GuestPlaceAsk, osm: OsmLookups): Promise<Record<string, unknown>> {
  if ("q" in ask) {
    // Google answers only as the capped backup (migration 243); the app then credits Google, not OpenStreetMap.
    const places = await osm.search(ask.q);
    return { configured: true, places, source: places.some((p) => p.via === "google") ? "google" : "osm" };
  }
  return { label: await osm.reverse(ask.lat, ask.lng) };
}

export type GuestPlacesVerdict = "ok" | "limited" | "busy";

/**
 * May this guest search now? The api's guest limiter first (a place search is heavy: refused unless it says "ok"),
 * then this function's own two counters. A counter that errors or cannot be reached refuses (busy): an outage of a
 * limiter never opens the service key, or OpenStreetMap, to everyone.
 */
export async function guestPlacesAllowed(
  db: Db,
  key: string,
  net: string,
  local: GuestLocalLimit,
  ceiling: GuestCeiling,
  onDown: (why: string) => void = () => {},
): Promise<GuestPlacesVerdict> {
  const verdict = await guestSpend(db, key, net, GUEST_PLACE_COST, local, onDown, ceiling);
  if (verdict === "limited") return "limited";
  if (verdict !== "ok") return "busy";
  const hit = async (user: string, bucket: string, limit: number): Promise<boolean | null> => {
    try {
      const r = await db.rpc("api_rate_hit", { p_user: user, p_bucket: bucket, p_limit: limit });
      if (r.error || typeof r.data !== "boolean") {
        onDown(r.error ? r.error.message : "unexpected answer");
        return null;
      }
      return r.data;
    } catch (e) {
      onDown(e instanceof Error ? e.message : String(e));
      return null;
    }
  };
  const mine = await hit(key, "places_guest", GUEST_PLACES_PER_MINUTE);
  if (mine === null) return "busy";
  if (!mine) return "limited";
  const all = await hit(ALL_GUESTS_KEY, "places_guest_all", GUEST_PLACES_ALL_PER_MINUTE);
  if (all === null || !all) return "busy";
  return "ok";
}
