/**
 * The production safety alarm (plan task 5.9): quiet on staging, loud on production when a test shortcut is on.
 * Run from the repo root:
 *   node --experimental-strip-types --test supabase/functions/_shared/safetyAlarm.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { alarmMessage, FORBIDDEN_IN_PRODUCTION, isProductionProject, safetyFindings, type SafetyInputs } from "./safetyAlarm.ts";

// Throwaway values, never a real key or project.
const PROD = "https://abcdefghijklmnopqrst.supabase.co";
const STAGING = "https://wjxvingpfbfvkfqhrguj.supabase.co";
const clean: SafetyInputs = {
  supabaseUrl: PROD,
  environment: "production",
  devOtpForAll: false,
  env: {},
  razorpayKeyIds: { RAZORPAY_KEY_ID: "rzp_live_THROWAWAYKEY01", RAZORPAYX_KEY_ID: undefined },
};
const codes = (i: SafetyInputs) => safetyFindings(i).map((f) => f.code);

test("a correctly set up production project is all clear", () => {
  assert.deepEqual(safetyFindings(clean), []);
});

test("staging and localhost are never judged, even with every shortcut on", () => {
  for (const url of [STAGING, "http://localhost:54321", "http://127.0.0.1:54321"]) {
    assert.equal(isProductionProject(url), false);
    assert.deepEqual(safetyFindings({
      supabaseUrl: url, environment: "staging", devOtpForAll: true,
      env: { ALLOW_ANY_OTP: "1", TEST_PHONES: "9990000001" }, razorpayKeyIds: { RAZORPAY_KEY_ID: "rzp_test_THROWAWAYKEY01" },
    }), []);
  }
});

test("a look-alike or missing address counts as production", () => {
  assert.equal(isProductionProject("https://wjxvingpfbfvkfqhrguj.supabase.co.evil.test"), true);
  assert.equal(isProductionProject(undefined), true);
});

test("the test sign-in on production fires, and only an explicit false is off", () => {
  assert.deepEqual(codes({ ...clean, devOtpForAll: true }), ["DEV_OTP_FOR_ALL_ON"]);
  assert.deepEqual(codes({ ...clean, devOtpForAll: undefined }), ["DEV_OTP_FOR_ALL_ON"]);
  assert.deepEqual(codes({ ...clean, devOtpForAll: "false" }), []);
});

test("the environment setting left at staging fires", () => {
  assert.deepEqual(codes({ ...clean, environment: "staging" }), ["ENVIRONMENT_NOT_PRODUCTION"]);
  assert.deepEqual(codes({ ...clean, environment: undefined }), ["ENVIRONMENT_NOT_PRODUCTION"]);
});

test("each forbidden function secret fires when set, and a blank one does not", () => {
  for (const name of FORBIDDEN_IN_PRODUCTION) {
    assert.deepEqual(codes({ ...clean, env: { [name]: "x" } }), [`${name}_SET`]);
    assert.deepEqual(codes({ ...clean, env: { [name]: "  " } }), []);
  }
});

test("a Razorpay test key fires; a live key or no key does not", () => {
  assert.deepEqual(codes({ ...clean, razorpayKeyIds: { RAZORPAYX_KEY_ID: "rzp_test_THROWAWAYKEY01" } }), ["RAZORPAYX_KEY_ID_IS_TEST_KEY"]);
  assert.deepEqual(codes({ ...clean, razorpayKeyIds: { RAZORPAY_KEY_ID: null } }), []);
});

test("the message lists codes and never a value", () => {
  const f = safetyFindings({ ...clean, env: { TEST_PHONES: "9990000001" }, razorpayKeyIds: { RAZORPAY_KEY_ID: "rzp_test_THROWAWAYKEY01" } });
  const msg = alarmMessage(f);
  assert.match(msg, /TEST_PHONES_SET/);
  assert.match(msg, /RAZORPAY_KEY_ID_IS_TEST_KEY/);
  assert.doesNotMatch(msg + JSON.stringify(f), /9990000001|THROWAWAYKEY01/);
});
