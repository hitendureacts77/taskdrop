// node --experimental-strip-types --test supabase/functions/_shared/secretsLoader.test.ts
// H70 (plan task 3.5b): a second request during the first Vault read waits for it instead of getting an empty value.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeVaultLoader } from "./secretsLoader.ts";

// Placeholder values only; these are not real secrets.
const FAKE = { EXAMPLE_KEY: "placeholder-value" };

test("two callers during one load both get the real value, from one load", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const loader = makeVaultLoader(async () => {
    calls++;
    await gate;
    return FAKE;
  });
  const first = loader.load();
  const second = loader.load(); // arrives while the first is still loading
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.get("EXAMPLE_KEY"), FAKE.EXAMPLE_KEY);
  assert.equal(b.get("EXAMPLE_KEY"), FAKE.EXAMPLE_KEY);
  assert.equal(calls, 1);
  // A later caller reuses the loaded copy: still one load.
  assert.equal((await loader.load()).get("EXAMPLE_KEY"), FAKE.EXAMPLE_KEY);
  assert.equal(calls, 1);
});

test("a failed load is not kept: the next call retries and gets the value", async () => {
  let calls = 0;
  const loader = makeVaultLoader(async () => {
    calls++;
    if (calls === 1) throw new Error("vault down");
    return FAKE;
  });
  const failed = await loader.load();
  assert.equal(failed.size, 0);
  assert.equal(calls, 1);
  const retried = await loader.load();
  assert.equal(retried.get("EXAMPLE_KEY"), FAKE.EXAMPLE_KEY);
  assert.equal(calls, 2);
});

test("callers waiting on a load that fails get an empty map, and the retry is shared", async () => {
  let calls = 0;
  let fail!: () => void;
  const gate = new Promise<void>((_, rej) => (fail = () => rej(new Error("down"))));
  const loader = makeVaultLoader(async () => {
    calls++;
    if (calls === 1) await gate;
    return FAKE;
  });
  const w1 = loader.load();
  const w2 = loader.load();
  fail();
  assert.equal((await w1).size, 0);
  assert.equal((await w2).size, 0);
  const [r1, r2] = await Promise.all([loader.load(), loader.load()]);
  assert.equal(r1.get("EXAMPLE_KEY"), FAKE.EXAMPLE_KEY);
  assert.equal(r2.get("EXAMPLE_KEY"), FAKE.EXAMPLE_KEY);
  assert.equal(calls, 2);
});

test("empty values are dropped, not stored", async () => {
  const loader = makeVaultLoader(async () => ({ A: "", B: "x" }));
  const m = await loader.load();
  assert.equal(m.has("A"), false);
  assert.equal(m.get("B"), "x");
});
