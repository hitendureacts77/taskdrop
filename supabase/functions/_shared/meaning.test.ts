/** node --experimental-strip-types --test supabase/functions/_shared/meaning.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { embedText, resetMeaningSession, toVectorLiteral } from "./meaning.ts";

const g = globalThis as Record<string, unknown>;

test("embedText is null when the model is not there", async () => {
  resetMeaningSession();
  delete g.Supabase;
  assert.equal(await embedText("tutoring"), null);
});

test("toVectorLiteral writes six decimals", () => {
  assert.equal(toVectorLiteral([0.1, -0.25, 1]), "[0.100000,-0.250000,1.000000]");
  assert.equal(toVectorLiteral([]), "[]");
});

test("embedText returns the vector from the model", async () => {
  resetMeaningSession();
  g.Supabase = { ai: { Session: class { async run() { return new Float32Array([0.5, 0.25]); } } } };
  assert.deepEqual(await embedText("tutoring"), [0.5, 0.25]);
  resetMeaningSession();
  delete g.Supabase;
});

test("embedText is null when the model is slower than the timeout", async () => {
  resetMeaningSession();
  g.Supabase = { ai: { Session: class { run() { return new Promise((r) => setTimeout(() => r([1]), 300)); } } } };
  assert.equal(await embedText("tutoring", 20), null);
  resetMeaningSession();
  delete g.Supabase;
});

test("embedText is null when the model throws", async () => {
  resetMeaningSession();
  g.Supabase = { ai: { Session: class { async run() { throw new Error("boom"); } } } };
  assert.equal(await embedText("tutoring"), null);
  resetMeaningSession();
  delete g.Supabase;
});
