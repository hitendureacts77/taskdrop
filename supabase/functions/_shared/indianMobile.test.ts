import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptsPhone, isIndianMobile } from "./indianMobile.ts";

test("real Indian mobile numbers pass, including the seed accounts", () => {
  for (const p of ["9876543210", "6000000001", "7012345678", "8123456789", "9990000001", "9990000003"]) {
    assert.equal(isIndianMobile(p), true, p);
  }
});

test("numbers that cannot be an Indian mobile are refused", () => {
  for (const p of ["0123456789", "1234567890", "5876543210", "987654321", "98765432101", "", "98765abcde"]) {
    assert.equal(isIndianMobile(p), false, p);
  }
});

test("one digit repeated is not a person", () => {
  for (const p of ["9999999999", "8888888888", "6666666666"]) assert.equal(isIndianMobile(p), false, p);
});

test("a TEST_PHONES number is taken even when it is not an Indian mobile; an unlisted bad number is not", () => {
  const testPhones = new Set(["1111111111"]);
  assert.equal(isIndianMobile("1111111111"), false);
  assert.equal(acceptsPhone("1111111111", testPhones), true);
  assert.equal(acceptsPhone("2222222222", testPhones), false);
  assert.equal(acceptsPhone("0123456789", testPhones), false);
  assert.equal(acceptsPhone("1111111111", new Set()), false);
  assert.equal(acceptsPhone("9876543210", testPhones), true);
});
