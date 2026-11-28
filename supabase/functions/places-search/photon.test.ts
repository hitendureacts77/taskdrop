// node --experimental-transform-types --no-warnings --test supabase/functions/places-search/photon.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { photonAreaName, photonPlaces, plainArea } from "./photon.ts";

const madhapur = {
  properties: { name: "Madhapur", district: "Ward 104 Kondapur", county: "Serilingampalle mandal", state: "Telangana", countrycode: "IN" },
  geometry: { coordinates: [78.3916304, 17.4408924] },
};

test("ward prefixes are dropped from area names", () => {
  assert.equal(plainArea("Ward 107 Madhapur"), "Madhapur");
  assert.equal(plainArea("Ward No. 5 Ameerpet"), "Ameerpet");
  assert.equal(plainArea("Kondapur"), "Kondapur");
  assert.equal(plainArea(undefined), "");
});

test("search results keep Indian places with a short label and a point", () => {
  const out = photonPlaces([
    madhapur,
    { properties: { name: "Madhapur", countrycode: "US" }, geometry: { coordinates: [1, 2] } },
    { properties: { name: "No point", countrycode: "IN" } },
  ], "Madhapur");
  assert.deepEqual(out, [{ label: "Madhapur, Kondapur, Serilingampalle mandal", lat: 17.4408924, lng: 78.3916304 }]);
});

test("same labels are shown once and at most six results come back", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    properties: { name: "Area " + (i % 8), state: "Telangana", countrycode: "IN" },
    geometry: { coordinates: [78 + i / 100, 17] },
  }));
  const out = photonPlaces(many, "Area");
  assert.equal(out.length, 6);
  assert.equal(new Set(out.map((p) => p.label)).size, 6);
});

test("reverse lookup gives the area and city, not a shop name", () => {
  assert.equal(
    photonAreaName([{ properties: { name: "Southern Spice", locality: "Ayyappa Society Colony", district: "Ward 107 Madhapur", city: "Hyderabad" } }]),
    "Ayyappa Society Colony, Hyderabad",
  );
  assert.equal(photonAreaName([{ properties: { district: "Ward 107 Madhapur", county: "Serilingampalle mandal" } }]), "Madhapur, Serilingampalle mandal");
  assert.equal(photonAreaName([]), null);
});
