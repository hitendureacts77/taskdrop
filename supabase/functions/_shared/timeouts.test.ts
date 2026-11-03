// node --experimental-strip-types --test supabase/functions/_shared/timeouts.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { OUTSIDE_CALL_MS, outsideCall } from "./timeouts.ts";

test("an outside call gives up after a few seconds, not minutes", () => {
  assert.ok(OUTSIDE_CALL_MS >= 3_000 && OUTSIDE_CALL_MS <= 15_000);
  const s = outsideCall(5);
  assert.equal(s.aborted, false);
});

test("a signal that has run out aborts the call", async () => {
  const s = outsideCall(5);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.aborted, true);
});

test("the calls a person waits for carry the timeout", () => {
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  assert.equal((read("phone-auth/index.ts").match(/signal: outsideCall\(\)/g) ?? []).length, 2, "the SMS send and the account lookup");
  assert.equal((read("razorpay/index.ts").match(/signal: outsideCall\(\)/g) ?? []).length, 2, "the two payment-link status checks");
  assert.match(read("places-search/index.ts"), /body: JSON\.stringify\(\{ textQuery: q, maxResultCount: 6 \}\),\s*signal: AbortSignal\.timeout\(6000\)/);
});
