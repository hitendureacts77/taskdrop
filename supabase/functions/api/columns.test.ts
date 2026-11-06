/**
 * Column decisions for the api function (plan task 2.18 part A, hole H74).
 *
 *   * no api read asks for "every column" (`select("*")`, `select()`, `tasks(*)`), except the allow-list below;
 *   * the lists in columns.ts do not overlap, hold the private columns on the private side only, and are the
 *     same lists as in supabase/tests/column_decisions.test.sql (which fails when the database gains a column).
 *
 * Run with: node --experimental-transform-types --no-warnings --test supabase/functions/api/columns.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  PROFILE_COLUMNS, PROFILE_OWNER_SELECT, PROFILE_PRIVATE, PROFILE_PUBLIC, PROFILE_PUBLIC_SELECT, TASK_COLUMNS, TASK_PARTIES_ONLY,
  TASK_PARTY_SELECT, TASK_PUBLIC, TASK_PUBLIC_SELECT, redactTask,
} from "./columns.ts";

const DIR = import.meta.dirname;

/**
 * Reads that may still return every column, and why. Key: "file:table". Value: how many and the reason.
 * Each is the row the caller has just written, under their own id; nothing here is a read of other people's rows.
 */
const ALLOWED: Record<string, { count: number; why: string }> = {
  "writes.ts:payout_destinations": { count: 2, why: "the destination the caller just added or removed (their own row)" },
  "writes.ts:tasks": { count: 5, why: "the post the caller just made or changed (their own row)" },
  "writes.ts:bids": { count: 2, why: "the offer the caller just sent or changed (their own row)" },
  "writes.ts:task_proofs": { count: 1, why: "the proof the caller just handed in (their own row)" },
  "writes.ts:messages": { count: 1, why: "the message the caller just sent (their own row)" },
  "writes.ts:crew_messages": { count: 1, why: "the crew message the caller just sent (their own row)" },
};

/** Code without whole-line comments, so a note that mentions select("*") is not a call. */
function code(src: string): string {
  return src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
}

test("no api read asks for every column, except the allow-list", () => {
  const found: Record<string, number> = {};
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "columns.ts")) {
    const src = code(readFileSync(join(DIR, file), "utf8"));
    for (const m of src.matchAll(/\.select\(\s*(?:\)|(["'`])([^"'`]*)\1)/g)) {
      const args = m[2] ?? "";
      const star = m[0].replace(/\s/g, "") === ".select()" || /(^|[\s,(])\*($|[\s,)])/.test(args) || /\(\*\)/.test(args);
      if (!star) continue;
      const before = src.slice(Math.max(0, m.index! - 700), m.index);
      const tables = [...before.matchAll(/\.from\(\s*"([a-z_]+)"\s*\)/g)];
      const table = tables.length ? tables[tables.length - 1][1] : "?";
      const key = `${file}:${table}`;
      found[key] = (found[key] ?? 0) + 1;
    }
  }
  for (const [key, n] of Object.entries(found)) {
    const allowed = ALLOWED[key];
    assert.ok(allowed, `${key}: a read asks for every column (${n}x). Name its columns in columns.ts, or add it to ALLOWED here with a reason.`);
    assert.ok(n <= allowed.count, `${key}: ${n} reads ask for every column, ${allowed.count} are allowed (${allowed.why})`);
  }
  for (const key of Object.keys(ALLOWED)) assert.ok(found[key], `${key} is on the allow-list but has no such read any more: remove it`);
});

test("no join asks for every column of tasks", () => {
  for (const file of ["reads.ts", "writes.ts", "ops.ts", "guest.ts"]) {
    assert.ok(!/tasks\(\*\)/.test(code(readFileSync(join(DIR, file), "utf8"))), `${file} embeds tasks(*)`);
  }
});

test("the private columns are on the private side only", () => {
  assert.equal(PROFILE_COLUMNS.length, new Set(PROFILE_COLUMNS).size, "a profiles column is listed twice");
  assert.equal(TASK_COLUMNS.length, new Set(TASK_COLUMNS).size, "a tasks column is listed twice");
  for (const k of ["payout_upi", "sessions_revoked_at", "sessions_keep_session", "weekly_goal_minor"]) {
    assert.ok((PROFILE_PRIVATE as readonly string[]).includes(k), `${k} must be private`);
    assert.ok(!(PROFILE_PUBLIC as readonly string[]).includes(k));
    assert.ok(!PROFILE_PUBLIC_SELECT.split(", ").includes(k));
  }
  for (const k of ["funded_minor", "funded_credits_minor", "funded_via", "funding_payment_id", "locked_minor", "locked_bid_id", "payout_mode", "wallet_refunded_at"]) {
    assert.ok((TASK_PARTIES_ONLY as readonly string[]).includes(k), `${k} must be parties only`);
    assert.ok(!(TASK_PUBLIC as readonly string[]).includes(k));
    assert.ok(!TASK_PUBLIC_SELECT.split(", ").includes(k));
    assert.ok(TASK_PARTY_SELECT.split(", ").includes(k));
  }
  for (const k of ["payout_upi", "sessions_revoked_at", "sessions_keep_session"]) assert.ok(!PROFILE_OWNER_SELECT.split(", ").includes(k));
  const redacted = redactTask({ id: "x", title: "t", locked_minor: 5, funded_minor: 6 });
  assert.deepEqual(redacted, { id: "x", title: "t" });
});

test("columns.ts and the SQL test name the same columns", () => {
  const sql = readFileSync(join(DIR, "../../tests/column_decisions.test.sql"), "utf8");
  const list = (name: string) => {
    const m = sql.match(new RegExp(`${name}\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`));
    assert.ok(m, `${name} not found in column_decisions.test.sql`);
    return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  };
  assert.deepEqual(list("v_profiles_public"), [...PROFILE_PUBLIC].sort());
  assert.deepEqual(list("v_profiles_private"), [...PROFILE_PRIVATE].sort());
  assert.deepEqual(list("v_tasks_public"), [...TASK_PUBLIC].sort());
  assert.deepEqual(list("v_tasks_parties"), [...TASK_PARTIES_ONLY].sort());
});
