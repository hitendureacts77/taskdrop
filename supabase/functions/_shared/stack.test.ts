/**
 * Tests for the stack parser behind captureServerError. Run from the repo root:
 *   node --experimental-strip-types --test supabase/functions/_shared/stack.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseStack } from "./stack.ts";

const stack = [
  "Error: boom",
  "    at recordPayout (file:///src/_shared/razorpayx.ts:164:10)",
  "    at async sendPayout (file:///src/_shared/razorpayx.ts:328:22)",
  "    at file:///src/razorpayx-payouts/index.ts:91:20",
  "    at ext:deno_http/00_serve.ts:393:20",
].join("\n");

test("frames come oldest call first, with function, file and position", () => {
  const frames = parseStack(stack);
  assert.equal(frames.length, 4);
  assert.deepEqual(frames[3], { function: "recordPayout", filename: "file:///src/_shared/razorpayx.ts", lineno: 164, colno: 10, in_app: true });
  assert.equal(frames[2].function, "sendPayout");
  assert.equal(frames[1].function, undefined);
});

test("runtime frames are not marked as the app's own code", () => {
  assert.equal(parseStack(stack)[0].in_app, false);
});

test("a missing or odd stack gives no frames", () => {
  assert.deepEqual(parseStack(undefined), []);
  assert.deepEqual(parseStack("Error: x\nnot a frame"), []);
});
