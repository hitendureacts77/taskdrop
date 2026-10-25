/**
 * The server's area rule must be the app's rule. Run from the repo root:
 *   node --experimental-strip-types --test supabase/functions/_shared/place.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as app from "../../../apps/mobile/src/lib/place.ts";
import * as server from "./place.ts";

const SAMPLES = [
  "Flat 402, Test Towers, Road 5, Near the park, Madhapur, Ward 104 Kondapur, Greater Hyderabad Municipal Corporation West Zone",
  "2222, Ward 104 Kondapur",
  "Road Number 8, Hyderabad, Telangana",
  "Madhapur, Hyderabad",
  "Remote",
  "12/3, 5th Cross, Indiranagar, Bengaluru, Karnataka 560038, India",
  "",
  null,
];

test("the same address gets the same area from the app and the server", () => {
  for (const label of SAMPLES) assert.equal(server.roughPlace(label), app.roughPlace(label), String(label));
});

test("the door-level part is dropped, the area stays", () => {
  assert.equal(server.roughPlace("Flat 402, Sai Residency, Madhapur, Hyderabad"), "Madhapur, Hyderabad");
  assert.equal(server.roughPlace("2222, Ward 104 Kondapur"), "Kondapur");
});
