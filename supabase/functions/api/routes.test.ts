/**
 * The endpoint table (./routes.ts): every operation has exactly one endpoint, the paths resolve to the right
 * operation, and the old single address keeps working for installed apps.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { OPS } from "./ops.ts";
import { API_GROUPS, GROUP_OF, endpointOf, requestFor, routeOf } from "./routes.ts";

test("every operation has exactly one endpoint, and every endpoint is a real operation", () => {
  const filed = Object.values(API_GROUPS).flat();
  const twice = filed.filter((op, i) => filed.indexOf(op) !== i);
  assert.deepEqual(twice, [], "filed under more than one group");
  const missing = Object.keys(OPS).filter((op) => !(op in GROUP_OF));
  assert.deepEqual(missing, [], "operations with no endpoint: add them to API_GROUPS");
  const ghosts = filed.filter((op) => !Object.prototype.hasOwnProperty.call(OPS, op));
  assert.deepEqual(ghosts, [], "endpoints with no operation behind them");
});

test("group names are plain lowercase path segments", () => {
  for (const group of Object.keys(API_GROUPS)) assert.match(group, /^[a-z]+$/);
  assert.ok(!("batch" in API_GROUPS) && !("health" in API_GROUPS), "batch and health are endpoints of their own");
});

test("endpointOf gives the path the app invokes", () => {
  assert.equal(endpointOf("listOpenTasks"), "api/tasks/listOpenTasks");
  assert.equal(endpointOf("placeBid"), "api/bids/placeBid");
  assert.equal(endpointOf("requestWithdrawal"), "api/wallet/requestWithdrawal");
  assert.equal(endpointOf("batch"), "api/batch");
  assert.equal(endpointOf("health"), "api/health");
  // An op the table does not know (an app ahead of its server) uses the old address, op in the body.
  assert.equal(endpointOf("someFutureOp"), "api");
  assert.equal(endpointOf("toString"), "api");
});

test("routeOf reads the endpoint from the path, hosted or local", () => {
  assert.deepEqual(routeOf("/api/tasks/listOpenTasks"), { kind: "op", op: "listOpenTasks", group: "tasks" });
  assert.deepEqual(routeOf("/functions/v1/api/bids/placeBid"), { kind: "op", op: "placeBid", group: "bids" });
  assert.deepEqual(routeOf("/api/bids/placeBid/"), { kind: "op", op: "placeBid", group: "bids" });
  assert.deepEqual(routeOf("/api/batch"), { kind: "batch" });
  assert.deepEqual(routeOf("/api/health"), { kind: "health" });
  assert.deepEqual(routeOf("/api"), { kind: "legacy" });
  assert.deepEqual(routeOf("/functions/v1/api"), { kind: "legacy" });
  assert.deepEqual(routeOf("/"), { kind: "legacy" });
});

test("routeOf refuses paths that name no endpoint", () => {
  for (const path of [
    "/api/wallet/listOpenTasks", // a real op under the wrong group
    "/api/tasks/noSuchOp",
    "/api/tasks",
    "/api/listOpenTasks",
    "/api/tasks/listOpenTasks/extra",
    "/api/tasks/constructor",
    "/api/tasks/__proto__",
  ]) assert.deepEqual(routeOf(path), { kind: "unknown" }, path);
});

test("requestFor: the endpoint's op wins; a body naming another op is refused", () => {
  const op = routeOf("/api/tasks/getTask");
  assert.deepEqual(requestFor(op, { args: { id: "x" } }), { op: "getTask", args: { id: "x" } });
  assert.deepEqual(requestFor(op, { op: "getTask", args: { id: "x" } }), { op: "getTask", args: { id: "x" } });
  assert.equal(requestFor(op, { op: "requestWithdrawal", args: {} }), null);
  assert.equal(requestFor(op, null), null);
  assert.equal(requestFor(op, [1]), null);

  const batch = routeOf("/api/batch");
  assert.deepEqual(requestFor(batch, { args: { calls: [] } }), { op: "batch", args: { calls: [] } });
  assert.equal(requestFor(batch, { op: "placeBid", args: {} }), null);

  // The old single address: the body is the request, exactly as before.
  const legacy = routeOf("/api");
  assert.deepEqual(requestFor(legacy, { op: "placeBid", args: { a: 1 } }), { op: "placeBid", args: { a: 1 } });
});
