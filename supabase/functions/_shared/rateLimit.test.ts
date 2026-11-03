// node --experimental-strip-types --test supabase/functions/_shared/rateLimit.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { withinRate } from "./rateLimit.ts";

const fake = (reply: { data?: unknown; error?: { message: string } } | "throw") => {
  const calls: unknown[] = [];
  const admin = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (reply === "throw") throw new Error("network down");
      return { data: reply.data ?? null, error: reply.error ?? null };
    },
  };
  return { admin: admin as never, calls };
};

test("a call under the limit goes ahead, and counts one hit under its own bucket", async () => {
  const { admin, calls } = fake({ data: true });
  assert.equal(await withinRate(admin, "u1", "payouts", 20), true);
  assert.deepEqual(calls, [{ name: "api_rate_hit", args: { p_user: "u1", p_bucket: "payouts", p_limit: 20 } }]);
});

test("a call over the limit is refused", async () => {
  assert.equal(await withinRate(fake({ data: false }).admin, "u1", "payouts", 20), false);
});

test("a counter that cannot be reached lets the call through and says so", async () => {
  const seen: string[] = [];
  assert.equal(await withinRate(fake({ error: { message: "db down" } }).admin, "u1", "p", 1, (m) => seen.push(m)), true);
  assert.equal(await withinRate(fake("throw").admin, "u1", "p", 1, (m) => seen.push(m)), true);
  assert.deepEqual(seen, ["db down", "network down"]);
});
