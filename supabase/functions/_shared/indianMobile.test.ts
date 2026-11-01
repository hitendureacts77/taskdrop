import { test } from "node:test";
import assert from "node:assert/strict";
import { isIndianMobile } from "./indianMobile.ts";

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
