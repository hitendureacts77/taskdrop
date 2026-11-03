// node --experimental-strip-types --test supabase/functions/_shared/returnUrl.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { safeReturnUrl } from "./returnUrl.ts";

test("TaskDrop's own websites are kept", () => {
  assert.equal(safeReturnUrl("https://taskdrop.in/", undefined), "https://taskdrop.in/");
  assert.equal(safeReturnUrl("https://www.taskdrop.in/?x=1", undefined), "https://www.taskdrop.in/?x=1");
  assert.equal(safeReturnUrl("https://taskdrop.in/", "https://taskdrop.in,https://www.taskdrop.in"), "https://taskdrop.in/");
});

test("any other address, or a malformed one, is dropped", () => {
  for (const bad of ["https://evil.example/", "https://taskdrop.in.evil.example/", "https://taskdrop.in@evil.example/", "javascript:alert(1)", "//evil.example", "taskdrop://x", "", null, 5, "x".repeat(600)]) {
    assert.equal(safeReturnUrl(bad, undefined), null, String(bad).slice(0, 40));
  }
});

test("production's list decides when it is set, so staging addresses stop working", () => {
  assert.equal(safeReturnUrl("https://taskdrop-five.vercel.app/", "https://taskdrop.in"), null);
  assert.equal(safeReturnUrl("http://localhost:8081/", "https://taskdrop.in"), null);
});
