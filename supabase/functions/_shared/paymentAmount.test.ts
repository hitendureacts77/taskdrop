// node --experimental-strip-types --test supabase/functions/_shared/paymentAmount.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { paidAmountMatches } from "./paymentAmount.ts";

test("the same figure passes, as a number or as text", () => {
  assert.equal(paidAmountMatches(123600, 123600), true);
  assert.equal(paidAmountMatches("123600", 123600), true);
  assert.equal(paidAmountMatches(123600, "123600"), true);
});

test("less or more than the amount on record is held", () => {
  assert.equal(paidAmountMatches(123600, 100), false);
  assert.equal(paidAmountMatches(123600, 123601), false);
  assert.equal(paidAmountMatches(100, 123600), false);
});

test("a missing or odd figure is held, never treated as a match", () => {
  for (const reported of [undefined, null, "", "  ", "abc", NaN, Infinity, {}, [], true]) {
    assert.equal(paidAmountMatches(123600, reported), false, String(reported));
  }
});

test("nothing passes when the amount on record is not a real price", () => {
  for (const expected of [undefined, null, 0, -100, 12.5, "abc", NaN]) {
    assert.equal(paidAmountMatches(expected, 0), false, String(expected));
    assert.equal(paidAmountMatches(expected, expected), false, String(expected));
  }
});
