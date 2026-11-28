// node --experimental-transform-types --no-warnings --test supabase/functions/places-search/google.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { googleAreaName, googlePlaces } from "./google.ts";

const tidy = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean).join(", ");

test("search results keep a label and a point, at most six", () => {
  const out = googlePlaces(
    [
      { formattedAddress: "Madhapur,  Hyderabad, Telangana, India", location: { latitude: 17.4486, longitude: 78.3908 } },
      { displayName: { text: "No point" } },
    ],
    "Madhapur",
    tidy,
  );
  assert.deepEqual(out, [{ label: "Madhapur, Hyderabad, Telangana, India", lat: 17.4486, lng: 78.3908, via: "google" }]);
  const many = Array.from({ length: 9 }, (_, i) => ({ displayName: { text: "P" + i }, location: { latitude: 17, longitude: 78 + i } }));
  assert.equal(googlePlaces(many, "P", tidy).length, 6);
});

test("area name is the neighbourhood and city, not the door number", () => {
  const near = [{
    addressComponents: [
      { longText: "No.2-2-7/1/5C", types: [] },
      { longText: "Shivam Road", types: ["route"] },
      { longText: "Sri Sai Nagar", types: ["sublocality_level_2", "sublocality", "political"] },
      { longText: "Madhapur", types: ["sublocality_level_1", "sublocality", "political"] },
      { longText: "Hyderabad", types: ["locality", "political"] },
    ],
  }];
  assert.equal(googleAreaName(near), "Madhapur, Hyderabad");
  assert.equal(googleAreaName([{ addressComponents: [{ longText: "Hyderabad", types: ["locality"] }] }]), "Hyderabad");
  assert.equal(googleAreaName([]), null);
});

test("results are credited to Google only when Google answered", async () => {
  const { sourceOf } = await import("./google.ts");
  assert.equal(sourceOf([{ via: "google" }]), "google");
  assert.equal(sourceOf([{}]), "osm");
  assert.equal(sourceOf([]), "osm");
});
