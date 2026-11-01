import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCors, originAllowed, parseOrigins, STAGING_ORIGINS } from "./cors.ts";

test("staging default: the site's own addresses and a local dev server are allowed", () => {
  for (const o of [...STAGING_ORIGINS, "http://localhost:8081", "http://127.0.0.1:8099", "http://localhost"]) {
    assert.equal(originAllowed(o, undefined), true, o);
  }
});

test("any other website is refused, however close its name", () => {
  for (const o of [
    "https://evil.example",
    "https://taskdrop.in.evil.example",
    "https://eviltaskdrop.in",
    "http://taskdrop.in",
    "https://other-app.vercel.app",
    "https://localhost:8081", // https localhost is not the dev server
    "http://localhost.evil.example",
  ]) {
    assert.equal(originAllowed(o, undefined), false, o);
  }
});

test("no Origin header (the Android app, a server) is not a browser: nothing is allowed or added", () => {
  assert.equal(originAllowed(null, undefined), false);
});

test("a configured list replaces the default completely (production: no localhost, no vercel.app)", () => {
  const raw = "https://taskdrop.in, https://www.taskdrop.in/ ,https://admin.taskdrop.in";
  assert.deepEqual(parseOrigins(raw), ["https://taskdrop.in", "https://www.taskdrop.in", "https://admin.taskdrop.in"]);
  assert.equal(originAllowed("https://admin.taskdrop.in", raw), true);
  assert.equal(originAllowed("http://localhost:8081", raw), false);
  assert.equal(originAllowed("https://taskdrop-five.vercel.app", raw), false);
  assert.equal(parseOrigins("  ,, "), null);
});

test("the answer names the caller's own origin, never *, and varies by Origin", () => {
  const ok = applyCors(
    new Request("https://x.test/", { headers: { Origin: "https://taskdrop.in" } }),
    new Response("{}", { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } }),
    undefined,
  );
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://taskdrop.in");
  assert.match(ok.headers.get("Vary") ?? "", /Origin/);
  assert.equal(ok.headers.get("Content-Type"), "application/json");

  const bad = applyCors(
    new Request("https://x.test/", { headers: { Origin: "https://evil.example" } }),
    new Response("{}", { headers: { "Access-Control-Allow-Origin": "*" } }),
    undefined,
  );
  assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);

  const app = applyCors(new Request("https://x.test/"), new Response("{}", { headers: { "Access-Control-Allow-Origin": "*" } }), undefined);
  assert.equal(app.headers.get("Access-Control-Allow-Origin"), null);
});

test("the response body and status survive", async () => {
  const res = applyCors(new Request("https://x.test/"), new Response('{"ok":true}', { status: 429 }), undefined);
  assert.equal(res.status, 429);
  assert.equal(await res.text(), '{"ok":true}');
});
