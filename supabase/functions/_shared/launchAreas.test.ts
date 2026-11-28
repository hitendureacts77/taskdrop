// Launch areas (migrations 260/261): what the api refuses and what app-config hands the app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insideLaunchAreas, kmBetween, parseControls, parseLaunchAreas, publicConfig, refusalFor } from "./controls.ts";

const HYD = { name: "Hyderabad", lat: 17.385, lng: 78.4867, radius_km: 40 };

test("launch areas read as off unless on and with an area", () => {
  assert.equal(parseLaunchAreas(undefined).on, false);
  assert.equal(parseLaunchAreas({ on: true, areas: [] }).on, false);
  assert.equal(parseLaunchAreas({ on: true, areas: [{ name: "x", lat: "bad", lng: 1, radius_km: 5 }] }).on, false);
  assert.equal(parseLaunchAreas({ on: true, areas: [HYD] }).on, true);
  assert.equal(parseLaunchAreas({ on: "true", areas: [HYD] }).on, false);
});

test("distance and inside", () => {
  assert.ok(Math.abs(kmBetween(17.385, 78.4867, 12.9716, 77.5946) - 500) < 30); // Hyderabad - Bengaluru ~500 km
  const la = parseLaunchAreas({ on: true, areas: [HYD] });
  assert.equal(insideLaunchAreas(la, 17.44, 78.38), true); // Kondapur
  assert.equal(insideLaunchAreas(la, 12.97, 77.59), false); // Bengaluru
  assert.equal(insideLaunchAreas(la, null, null), true); // remote job: no place
  assert.equal(insideLaunchAreas(parseLaunchAreas({ on: false, areas: [HYD] }), 12.97, 77.59), true);
});

test("createTask outside every area is refused with the admin's message; inside and remote go ahead", () => {
  const c = parseControls({ launch_areas: { on: true, message: "Coming soon to your city.", areas: [HYD] } })!;
  const off = refusalFor("createTask", c, { locLat: 12.97, locLng: 77.59 });
  assert.deepEqual(off, { message: "Coming soon to your city.", code: "FEATURE_OFF", details: "launch_areas" });
  assert.equal(refusalFor("createTask", c, { locLat: 17.44, locLng: 78.38 }), null);
  assert.equal(refusalFor("createTask", c, {}), null);
  assert.equal(refusalFor("placeBid", c, { locLat: 12.97, locLng: 77.59 }), null);
  // Missing from an old database: nothing is refused.
  assert.equal(refusalFor("createTask", parseControls({})!, { locLat: 12.97, locLng: 77.59 }), null);
});

test("app-config passes the walkthrough link and the areas", () => {
  const cfg = publicConfig(
    parseControls({ walkthrough_url: "https://youtu.be/dQw4w9WgXcQ", launch_areas: { on: true, message: null, areas: [HYD] } })!,
    { platform: "web", appVersion: null },
  );
  assert.equal(cfg.walkthroughUrl, "https://youtu.be/dQw4w9WgXcQ");
  assert.deepEqual(cfg.launchAreas, { on: true, message: null, areas: [{ name: "Hyderabad", lat: 17.385, lng: 78.4867, radiusKm: 40 }] });
  const empty = publicConfig(parseControls({})!, { platform: null, appVersion: null });
  assert.equal(empty.walkthroughUrl, null);
  assert.equal(empty.launchAreas.on, false);
});
