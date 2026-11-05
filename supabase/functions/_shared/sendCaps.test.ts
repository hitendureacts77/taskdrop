import assert from "node:assert/strict";
import { test } from "node:test";
import { accountFromMode, phoneCounterKey, placesSource, smsRefusal } from "./sendCaps.ts";

test("an ok answer lets the SMS go", () => {
  assert.equal(smsRefusal("ok"), null);
});

test("a number past its daily limit is told so in plain words", () => {
  const r = smsRefusal("phone_cap");
  assert.equal(r?.status, 429);
  assert.match(r!.body.error, /this number today/);
  assert.equal(r!.body.capReached, undefined);
});

test("the day's allowance used up keeps the capReached flag the app already knows", () => {
  const r = smsRefusal("day_cap");
  assert.equal(r?.status, 429);
  assert.equal(r!.body.capReached, true);
});

test("anything unexpected refuses rather than sends", () => {
  for (const odd of [null, undefined, true, false, "", "OK", "okay", 1, { ok: true }, "error"]) {
    const r = smsRefusal(odd);
    assert.equal(r?.status, 503, `${String(odd)} must refuse`);
  }
});

test("refusal messages do not reveal whether a number has an account", () => {
  for (const key of ["phone_cap", "day_cap", "other"]) {
    assert.doesNotMatch(smsRefusal(key)!.body.error, /account/i);
  }
});

test("the door a request came through says whether the number has an account", () => {
  assert.equal(accountFromMode("signin"), true);
  assert.equal(accountFromMode("signup"), false);
  // No door named: the caller must look the number up, never assume the reserve applies.
  for (const odd of [undefined, null, "", "SIGNIN", "anything", 1]) {
    assert.equal(accountFromMode(odd), null, `${String(odd)}`);
  }
});

test("the counter key is a 64-character hash that holds no part of the number", async () => {
  const phone = "9876543210";
  const key = await phoneCounterKey(phone, "server-key-for-test");
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key.includes(phone), false);
  assert.equal(key.includes(phone.slice(-4)), false);
});

test("the same number and key always give the same counter key; another number or key does not", async () => {
  const a = await phoneCounterKey("9876543210", "k1");
  assert.equal(await phoneCounterKey("9876543210", "k1"), a);
  assert.notEqual(await phoneCounterKey("9876543211", "k1"), a);
  assert.notEqual(await phoneCounterKey("9876543210", "k2"), a);
});

test("only an ok answer may call Google; every other answer uses OpenStreetMap", () => {
  assert.equal(placesSource("ok"), "google");
  for (const other of ["user_cap", "total_cap", null, undefined, true, "", "OK"]) {
    assert.equal(placesSource(other), "osm", `${String(other)} must not call Google`);
  }
});
