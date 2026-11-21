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

test("round 8 (S1-10): no door number or PIN code reaches the public label", () => {
  const cases: [string, string | null][] = [
    ["A-402, Sai Residency, Madhapur", "Madhapur"],
    ["H-12, Kondapur", "Kondapur"],
    ["Flat402, Madhapur", "Madhapur"],
    ["B402, Gachibowli, Hyderabad", "Gachibowli, Hyderabad"],
    ["H.No-12, Kukatpally", "Kukatpally"],
    ["12 MG Road, Bengaluru", "Bengaluru"],
    ["Madhapur, Telangana 500081", "Madhapur, Telangana"],
    ["12/3, 5th Cross, Indiranagar, Bengaluru, Karnataka 560038, India", "Bengaluru, Karnataka"],
    // Areas stay.
    ["4th Block, Koramangala", "4th Block, Koramangala"],
    ["Sector 62, Noida", "Sector 62, Noida"],
    ["HSR Layout, Bengaluru", "HSR Layout, Bengaluru"],
  ];
  for (const [label, want] of cases) {
    assert.equal(server.roughPlace(label), want, label);
    assert.equal(app.roughPlace(label), want, label);
  }
});
