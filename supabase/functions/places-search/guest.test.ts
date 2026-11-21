// node --experimental-transform-types --no-warnings --test supabase/functions/places-search/guest.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GuestCeiling, GuestLocalLimit } from "../api/guest.ts";
import {
  ALL_GUESTS_KEY, GUEST_PLACES_ALL_PER_MINUTE, GUEST_PLACES_PER_MINUTE, GUEST_PLACE_COST, GUEST_Q_MAX,
  answerGuest, guestPlaceAsk, guestPlacesAllowed,
} from "./guest.ts";

type Call = { rpc: string; args: Record<string, unknown> };
/** A fake database: api_guest_spend answers `spend`, api_rate_hit answers by bucket. */
function fakeDb(spend: unknown, hits: Record<string, unknown> = {}, broken = false) {
  const calls: Call[] = [];
  const db = {
    rpc: async (rpc: string, args: Record<string, unknown> = {}) => {
      calls.push({ rpc, args });
      if (broken) throw new Error("db down");
      if (rpc === "api_guest_spend") return { data: spend, error: null };
      if (rpc === "api_rate_hit") {
        const v = hits[String(args.p_bucket)];
        return v === "error" ? { data: null, error: { message: "no counter" } } : { data: v ?? true, error: null };
      }
      return { data: null, error: { message: "unknown" } };
    },
  };
  return { db, calls };
}
const allowed = (db: ReturnType<typeof fakeDb>["db"]) => guestPlacesAllowed(db, "k", "n", new GuestLocalLimit(), new GuestCeiling());

test("B100 guest place ask: a typed text of 2 to 80 characters, trimmed", () => {
  assert.deepEqual(guestPlaceAsk({ q: "  Kondapur " }), { q: "Kondapur" });
  assert.equal(guestPlaceAsk({ q: "K" }), null);
  assert.equal(guestPlaceAsk({ q: "x".repeat(GUEST_Q_MAX + 1) }), null);
  assert.deepEqual(guestPlaceAsk({ q: "x".repeat(GUEST_Q_MAX) }), { q: "x".repeat(GUEST_Q_MAX) });
  for (const bad of [null, [], "Kondapur", { q: 5 }, {}]) assert.equal(guestPlaceAsk(bad), null);
});

test("B145 guest place ask: typed key by key, every prefix is checked the same way", () => {
  const typed = "Madhapur, Hyderabad";
  let text = "";
  for (const ch of typed) {
    text += ch;
    const ask = guestPlaceAsk({ q: text });
    if (text.trim().length < 2) assert.equal(ask, null, text);
    else assert.deepEqual(ask, { q: text.trim() }, text);
  }
});

test("B145 guest place ask: a GPS point is rounded to two decimals before anything else sees it", () => {
  assert.deepEqual(guestPlaceAsk({ lat: 17.469812, lng: 78.357634 }), { lat: 17.47, lng: 78.36 });
  assert.equal(guestPlaceAsk({ lat: 91, lng: 0 }), null);
  assert.equal(guestPlaceAsk({ lat: Number.NaN, lng: 0 }), null);
});

test("B145 a guest's answer comes from OpenStreetMap through the server, with the rounded point", async () => {
  const seen: unknown[] = [];
  const osm = {
    search: async (q: string) => (seen.push(["search", q]), [{ label: "Kondapur", lat: 17.46, lng: 78.35 }]),
    reverse: async (lat: number, lng: number) => (seen.push(["reverse", lat, lng]), "Kondapur, Hyderabad"),
  };
  assert.deepEqual(await answerGuest({ q: "Kondapur" }, osm), { configured: true, places: [{ label: "Kondapur", lat: 17.46, lng: 78.35 }], source: "osm" });
  const ask = guestPlaceAsk({ lat: 17.469812, lng: 78.357634 });
  assert.ok(ask);
  assert.deepEqual(await answerGuest(ask, osm), { label: "Kondapur, Hyderabad" });
  assert.deepEqual(seen, [["search", "Kondapur"], ["reverse", 17.47, 78.36]]);
});

test("B100 guest limiter: counted as a heavy guest read, then per address and for all guests", async () => {
  const { db, calls } = fakeDb("ok");
  assert.equal(await allowed(db), "ok");
  assert.deepEqual(calls.map((c) => c.rpc), ["api_guest_spend", "api_rate_hit", "api_rate_hit"]);
  assert.equal(calls[0].args.p_cost, GUEST_PLACE_COST);
  assert.deepEqual(calls[1].args, { p_user: "k", p_bucket: "places_guest", p_limit: GUEST_PLACES_PER_MINUTE });
  assert.deepEqual(calls[2].args, { p_user: ALL_GUESTS_KEY, p_bucket: "places_guest_all", p_limit: GUEST_PLACES_ALL_PER_MINUTE });
});

test("B100 guest limiter: over a limit is refused; a counter that is down refuses (never open)", async () => {
  assert.equal(await allowed(fakeDb("limited").db), "limited");
  assert.equal(await allowed(fakeDb("busy").db), "busy");
  assert.equal(await allowed(fakeDb("heavy_off").db), "busy");
  assert.equal(await allowed(fakeDb("ok", { places_guest: false }).db), "limited");
  assert.equal(await allowed(fakeDb("ok", { places_guest_all: false }).db), "busy");
  assert.equal(await allowed(fakeDb("ok", { places_guest: "error" }).db), "busy");
  assert.equal(await allowed(fakeDb("ok", { places_guest_all: "error" }).db), "busy");
  // The whole database unreachable: the stand-in budget gives light reads only, and a place search is not light.
  assert.equal(await allowed(fakeDb("ok", {}, true).db), "busy");
});

test("B100 places-search: guests are recognised as the api does and never reach Google", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(src, /isGuestToken\(/);
  assert.match(src, /guestPlacesAllowed\(/);
  const guestPart = src.slice(src.indexOf("async function handleGuest"), src.indexOf("// OpenStreetMap's Nominatim"));
  assert.ok(guestPart.length > 100, "handleGuest not found");
  assert.ok(!guestPart.includes("googleapis"), "the guest path must not call Google");
  assert.ok(!guestPart.includes("take_places_daily"), "the guest path must not spend the signed-in Google cap");
});
