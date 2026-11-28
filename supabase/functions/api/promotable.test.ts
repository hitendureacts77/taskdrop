/** node --experimental-transform-types --no-warnings --test supabase/functions/api/promotable.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { crewFilled, isPromotable, pageOf, toPromotable, type PromotableRow } from "./promotable.ts";

const row = (o: Partial<PromotableRow> = {}): PromotableRow => ({
  id: "t1", title: "Fix tap", category: "plumbing", kind: "request", benchmark_minor: 50000, status: "OPEN",
  crew_id: null, crew_size: null, crew_slot: null, ...o,
});

test("an open post nobody accepted can be promoted", () => {
  assert.equal(isPromotable(row(), {}), true);
});

test("a post past OPEN cannot", () => {
  for (const status of ["LOCKED", "TASK_STARTED", "COMPLETED", "CANCELLED", "WORK_DONE"]) {
    assert.equal(isPromotable(row({ status }), {}), false, status);
  }
});

test("a crew job can while it has fewer workers than wanted", () => {
  const crew = row({ crew_id: "c1", crew_size: 5, crew_slot: 3 });
  assert.equal(isPromotable(crew, { c1: 1 }), true);
  assert.equal(isPromotable(crew, { c1: 4 }), true);
  assert.equal(isPromotable(crew, { c1: 5 }), false);
});

test("crewFilled counts taken slots only, not open or cancelled ones", () => {
  const filled = crewFilled([
    { crew_id: "c1", status: "LOCKED" },
    { crew_id: "c1", status: "OPEN" },
    { crew_id: "c1", status: "CANCELLED" },
    { crew_id: "c1", status: "TASK_STARTED" },
    { crew_id: null, status: "LOCKED" },
    { crew_id: "c2", status: "OPEN" },
  ]);
  assert.deepEqual(filled, { c1: 2 });
});

test("toPromotable carries the fill and the offer count", () => {
  const crew = row({ crew_id: "c1", crew_size: 5, crew_slot: 2 });
  const t = toPromotable(crew, { t1: 3 }, { c1: 1 });
  assert.equal(t.filled, 1);
  assert.equal(t.wanted, 5);
  assert.equal(t.quotes, 3);
  const solo = toPromotable(row(), {}, {});
  assert.equal(solo.filled, 0);
  assert.equal(solo.wanted, 1);
});

test("pageOf cuts a page and says whether more is left", () => {
  const eleven = Array.from({ length: 11 }, (_, i) => i);
  assert.deepEqual(pageOf(eleven, 10), { items: eleven.slice(0, 10), hasMore: true });
  assert.deepEqual(pageOf(eleven.slice(0, 10), 10), { items: eleven.slice(0, 10), hasMore: false });
  assert.deepEqual(pageOf([], 10), { items: [], hasMore: false });
});
