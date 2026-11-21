import assert from "node:assert/strict";
import { test } from "node:test";
import { clockSkewFetch, isClockSkewBody } from "./clockSkewFetch.ts";

const skew = () => new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), { status: 401 });
const ok = () => new Response("[]", { status: 200 });
const noWait = async () => {};

test("the clock-skew text is recognised, other refusals are not", () => {
  assert.equal(isClockSkewBody('{"message":"JWT issued at future"}'), true);
  assert.equal(isClockSkewBody('{"message":"JWT expired"}'), false);
  assert.equal(isClockSkewBody(""), false);
});

test("a clock-skew 401 is asked again and the good answer is returned", async () => {
  let calls = 0;
  const f = clockSkewFetch(async () => (++calls < 3 ? skew() : ok()), { sleep: noWait });
  const res = await f("https://x/rpc/a");
  assert.equal(res.status, 200);
  assert.equal(calls, 3);
});

test("it gives up after the retries and returns the last 401 unchanged", async () => {
  let calls = 0;
  const f = clockSkewFetch(async () => (calls++, skew()), { retries: 2, sleep: noWait });
  const res = await f("https://x/rpc/a");
  assert.equal(res.status, 401);
  assert.equal(calls, 3);
  assert.match(await res.text(), /issued at future/);
});

test("any other 401 passes straight through with no retry", async () => {
  let calls = 0;
  const f = clockSkewFetch(async () => (calls++, new Response('{"message":"JWT expired"}', { status: 401 })), { sleep: noWait });
  const res = await f("https://x/rpc/a");
  assert.equal(res.status, 401);
  assert.equal(calls, 1);
});

test("a good first answer is returned without any wait", async () => {
  let waited = 0;
  const f = clockSkewFetch(async () => ok(), { sleep: async () => { waited++; } });
  assert.equal((await f("https://x")).status, 200);
  assert.equal(waited, 0);
});
