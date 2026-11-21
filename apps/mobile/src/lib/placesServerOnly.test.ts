// node --experimental-strip-types --test apps/mobile/src/lib/placesServerOnly.test.ts
// B145: the app never asks a third-party map search itself. Place search and "what is here" go through the
// places-search Edge Function (guests included), which rounds a guest's point and applies the limits.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = readFileSync(new URL("./location.ts", import.meta.url), "utf8");

test("B145 location.ts has no direct OpenStreetMap or other third-party geocoder call", () => {
  assert.ok(!/nominatim\.openstreetmap/i.test(src), "location.ts still calls Nominatim");
  assert.ok(!/OSM_HEADERS/.test(src), "location.ts still builds OpenStreetMap request headers");
  assert.ok(!/maps\.googleapis|places\.googleapis/i.test(src), "location.ts calls Google directly");
  assert.ok(!/\bfetch\(/.test(src), "location.ts makes its own network call; use the places-search function");
});

test("B145 the website's content policy no longer lets the browser reach Nominatim", () => {
  const vercel = readFileSync(new URL("../../../../vercel.json", import.meta.url), "utf8");
  assert.ok(!/nominatim/i.test(vercel), "vercel.json connect-src still allows nominatim.openstreetmap.org");
});

test("B100 location.ts asks the places-search function for both a typed place and a point", () => {
  assert.equal((src.match(/functions\.invoke\('places-search'/g) ?? []).length, 2);
});
