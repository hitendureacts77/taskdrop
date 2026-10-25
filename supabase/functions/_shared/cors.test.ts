import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The app calls these functions with supabase-js and a region, which adds an `x-region` header. A browser
// sends a preflight first; if the function's answer does not list that header, the browser blocks the call.
// Found 2026-10-24: places-search left it out, so address search failed on the web build.
for (const name of ["api", "app-config", "razorpay", "places-search"]) {
  test(`${name} allows the x-region header the web app sends`, () => {
    const src = readFileSync(new URL(`../${name}/index.ts`, import.meta.url), "utf8");
    const line = src.split("\n").find((l) => l.includes("Access-Control-Allow-Headers"));
    assert.ok(line, `${name} has a CORS header list`);
    assert.match(src.slice(src.indexOf("Access-Control-Allow-Headers"), src.indexOf("Access-Control-Allow-Headers") + 400), /x-region/);
  });
}
