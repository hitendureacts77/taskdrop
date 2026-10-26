/**
 * The key-mode rule: staging refuses live keys, production refuses test keys.
 * Run from the repo root:
 *   node --experimental-strip-types --test supabase/functions/_shared/keyMode.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ENVIRONMENTS, keyKind, keyRefusal, parseEnvironment,
  LIVE_KEY_IN_STAGING_MESSAGE, TEST_KEY_IN_PRODUCTION_MESSAGE, UNKNOWN_KEY_KIND_MESSAGE,
} from "./keyMode.ts";

// Throwaway names, never a real key.
const LIVE = "rzp_live_THROWAWAYKEY01";
const TEST = "rzp_test_THROWAWAYKEY01";

test("only the exact word production means production; everything else is staging", () => {
  assert.deepEqual([...ENVIRONMENTS], ["staging", "production"]);
  assert.equal(parseEnvironment("production"), "production");
  for (const v of ["staging", "Production", " production", "prod", "", null, undefined, 1, true, {}]) {
    assert.equal(parseEnvironment(v), "staging", String(v));
  }
});

test("a key's kind comes from its prefix", () => {
  assert.equal(keyKind(LIVE), "live");
  assert.equal(keyKind(TEST), "test");
  assert.equal(keyKind(`  ${TEST}  `), "test");
  for (const v of ["", "   ", "abc", "RZP_LIVE_X", "xrzp_live_x", "rzp_live", "rzp_prod_x", null, undefined]) {
    assert.equal(keyKind(v), "unknown", String(v));
  }
});

test("staging refuses a live key and accepts a test key", () => {
  const r = keyRefusal("staging", LIVE);
  assert.deepEqual(r, { code: "LIVE_KEY_IN_STAGING", message: LIVE_KEY_IN_STAGING_MESSAGE });
  assert.equal(keyRefusal("staging", TEST), null);
});

test("production refuses a test key and accepts a live key", () => {
  const r = keyRefusal("production", TEST);
  assert.deepEqual(r, { code: "TEST_KEY_IN_PRODUCTION", message: TEST_KEY_IN_PRODUCTION_MESSAGE });
  assert.equal(keyRefusal("production", LIVE), null);
});

test("a key of an unknown kind is refused in both environments", () => {
  for (const env of ENVIRONMENTS) {
    assert.deepEqual(keyRefusal(env, "not-a-razorpay-key"), { code: "UNKNOWN_KEY_KIND", message: UNKNOWN_KEY_KIND_MESSAGE });
  }
});

test("a missing key is left to the caller's own 'not configured' answer", () => {
  for (const env of ENVIRONMENTS) {
    for (const v of [undefined, null, "", "  "]) assert.equal(keyRefusal(env, v), null, `${env} ${String(v)}`);
  }
});

test("a refusal never repeats the key", () => {
  for (const [env, key] of [["staging", LIVE], ["production", TEST], ["staging", "oops_secret_value"]] as const) {
    const r = keyRefusal(env, key);
    assert.ok(r && !r.message.includes(key));
  }
});
