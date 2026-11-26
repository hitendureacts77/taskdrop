// Smart search understanding (plan 1.19 row D): a fixed set of searches and what each must be read as.
import assert from "node:assert/strict";
import test from "node:test";
import { distance, embed, fixWord, nearConcepts, setEmbedder, suggestConcepts, understand, whyLine } from "./search.ts";

const chips = (q: string) => understand(q).chips.map((c) => c.id);

test("fix my tap: plumbing, about the tap and not every post that says fix", () => {
  const u = understand("fix my tap");
  assert.deepEqual(u.chips.map((c) => c.id), ["plumbing"]);
  assert.deepEqual(u.words, ["tap"]);
  for (const w of ["plumber", "leak", "pipe", "sink"]) assert.ok(u.expanded.includes(w), w);
});

test("need someone to drop parcel: pickup and drop", () => {
  const u = understand("need someone to drop parcel");
  assert.equal(u.chips[0]?.id, "delivery");
  assert.deepEqual(u.words, ["drop", "parcel"]);
  assert.ok(u.expanded.includes("courier"));
});

test("laptop slow: computer repair", () => assert.deepEqual(chips("laptop slow"), ["computer"]));
test("AC service and Hinglish 'AC thanda nahi kar raha': AC repair", () => {
  assert.ok(chips("AC service").includes("ac"));
  assert.deepEqual(chips("AC thanda nahi kar raha"), ["ac"]);
});
test("bijli ka kaam: electrician", () => assert.deepEqual(chips("bijli ka kaam"), ["electrical"]));
test("bathroom nal dripping: plumbing", () => assert.ok(chips("bathroom nal dripping").includes("plumbing")));
test("kaamwali bai chahiye: cleaning", () => assert.deepEqual(chips("kaamwali bai chahiye"), ["cleaning"]));
test("wedding mehndi: beauty and event", () => {
  const c = chips("wedding mehndi");
  assert.ok(c.includes("beauty") && c.includes("event"), c.join());
});
test("plurals and -ing count: pipes, leaking", () => assert.deepEqual(chips("pipes leaking"), ["plumbing"]));

test("a vague word gives way to a specific one: 'fix the fan' is the electrician, not a handyman", () => {
  assert.deepEqual(chips("fix the fan"), ["electrical"]);
  // Only vague words: the handyman stays.
  assert.deepEqual(chips("repair"), ["handyman"]);
});

test("spelling slips are fixed, and exact keeps them", () => {
  assert.equal(fixWord("plumbr"), "plumber");
  assert.equal(fixWord("electrition"), "electrician");
  const u = understand("plumbr");
  assert.equal(u.corrected, "plumber");
  assert.deepEqual(u.chips.map((c) => c.id), ["plumbing"]);
  const kept = understand("plumbr", { exact: true });
  assert.equal(kept.corrected, null);
  assert.deepEqual(kept.chips, []);
});

test("known and short words are never 'fixed'", () => {
  for (const w of ["cake", "drop", "today", "birthday", "tutor"]) assert.equal(fixWord(w), w);
  assert.equal(understand("birthday cake").corrected, null);
});

test("taking a chip off drops it", () => {
  assert.deepEqual(understand("wedding mehndi", { drop: ["event"] }).chips.map((c) => c.id), ["beauty"]);
});

test("unknown search: no chips, own words kept, nothing fixed", () => {
  const u = understand("quantum origami");
  assert.deepEqual(u.chips, []);
  assert.deepEqual(u.words, ["quantum", "origami"]);
});

test("only filler: the words are kept so the search still has something", () => {
  assert.deepEqual(understand("need help").words, ["need", "help"]);
});

test("odd input is cleaned", () => {
  assert.equal(understand("  A/C   not-cooling!! ").query, "ac not cooling");
  assert.equal(understand("").query, "");
  assert.equal(understand("x".repeat(500)).query.length, 200);
});

test("suggestions while typing: whole words and the start of one", () => {
  assert.equal(suggestConcepts("fix my tap")[0]?.id, "plumbing");
  assert.ok(suggestConcepts("plum").some((c) => c.id === "plumbing"));
  assert.deepEqual(suggestConcepts("p"), []);
  assert.ok(suggestConcepts("electric").length <= 3);
});

test("close kinds of work for an empty result", () => {
  const near = nearConcepts([{ id: "beauty" }]).map((c) => c.id);
  assert.ok(near.length > 0 && !near.includes("beauty"));
});

test("why line: same need, own words, related", () => {
  const u = understand("fix my tap");
  assert.equal(whyLine({ title: "Kitchen sink is leaking, need a plumber today" }, u), "Same need: plumber, leak");
  assert.equal(whyLine({ title: "Change a tap" }, understand("tap")), "Has your words: tap");
  assert.equal(whyLine({ title: "Mixer fitting" }, u), "Related: plumbing");
  assert.equal(whyLine({ title: "Anything" }, understand("")), null);
});

test("distance stops early", () => {
  assert.equal(distance("plumbr", "plumber"), 1);
  assert.ok(distance("cake", "electrician") > 2);
});

test("embed: null without the model, cached, and gives up when slow", async () => {
  setEmbedder(null);
  assert.equal(await embed("no model here"), null);
  let calls = 0;
  setEmbedder(async () => {
    calls++;
    return Array.from({ length: 384 }, () => 0.1);
  });
  assert.equal((await embed("tap"))?.length, 384);
  await embed("tap");
  assert.equal(calls, 1);
  setEmbedder(() => new Promise((r) => setTimeout(() => r([1]), 200)));
  assert.equal(await embed("slow one", 20), null);
  setEmbedder(null);
});
