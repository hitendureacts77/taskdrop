/**
 * The admin panel's sign-in switches, as the auth functions apply them. Run from the repo root:
 *   node --experimental-strip-types --test supabase/functions/_shared/signInSwitches.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { signInRefusal } from "./signInSwitches.ts";

const headers = (platform: string | null) => ({
  get: (n: string) => (n.toLowerCase() === "x-taskdrop-platform" ? platform : n.toLowerCase() === "x-taskdrop-app-version" ? "1.0.0" : null),
});
const dbWith = (controls: Record<string, unknown> | null, error: unknown = null) => ({
  rpc: async () => ({ data: controls, error }),
});

test("everything on lets everyone through", async () => {
  const db = dbWith({ platform: "android" });
  for (const kind of ["phone", "password", "signup"] as const) assert.equal(await signInRefusal(db, headers("android"), kind), null, kind);
});

test("each switch refuses only its own kind of sign-in", async () => {
  assert.match((await signInRefusal(dbWith({ platform: "android", signin_phone: false }), headers("android"), "phone")) ?? "", /mobile number/);
  assert.equal(await signInRefusal(dbWith({ platform: "android", signin_phone: false }), headers("android"), "password"), null);
  assert.match((await signInRefusal(dbWith({ platform: "android", signin_password: false }), headers("android"), "password")) ?? "", /password/);
  assert.match((await signInRefusal(dbWith({ platform: "android", signups_open: false }), headers("android"), "signup")) ?? "", /sign-ups/);
  assert.equal(await signInRefusal(dbWith({ platform: "android", signups_open: false }), headers("android"), "phone"), null);
});

test("maintenance refuses every kind, with the admin's message", async () => {
  const db = dbWith({ platform: "web", maintenance: true, maintenance_message: "Back at 6" });
  for (const kind of ["phone", "password", "signup"] as const) assert.equal(await signInRefusal(db, headers("web"), kind), "Back at 6");
});

test("if the switches cannot be read, nobody is locked out", async () => {
  assert.equal(await signInRefusal(dbWith(null, { message: "down" }), headers("android"), "phone"), null);
  const throwing = { rpc: () => { throw new Error("boom"); } };
  assert.equal(await signInRefusal(throwing as never, headers("android"), "phone"), null);
});
