/**
 * Tests for the App Check monitor. Run from the repo root:
 *   node --experimental-strip-types --test supabase/functions/_shared/appCheck.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AppCheckLog, checkAppCheck, resetAppCheckKeys } from "./appCheck.ts";

const PROJECT = "123456789";
const now = Date.parse("2026-10-24T12:00:00Z");

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
const keys = async () => [publicJwk];

async function token(claims: Record<string, unknown>, header: Record<string, unknown> = {}, signWith = pair.privateKey) {
  const h = enc({ alg: "RS256", typ: "JWT", kid: "k1", ...header });
  const p = enc(claims);
  const sig = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signWith, new TextEncoder().encode(`${h}.${p}`))).toString("base64url");
  return `${h}.${p}.${sig}`;
}

const good = {
  iss: `https://firebaseappcheck.googleapis.com/${PROJECT}`,
  aud: [`projects/${PROJECT}`, "projects/taskdrop"],
  exp: now / 1000 + 600,
};

test("with no project number the check is off and reads nothing", async () => {
  resetAppCheckKeys();
  assert.equal(await checkAppCheck("anything", "", { now }), "off");
});

test("no token is reported as missing, not invalid", async () => {
  resetAppCheckKeys();
  assert.equal(await checkAppCheck(null, PROJECT, { now, fetchKeys: keys }), "missing");
});

test("a correctly signed, current token for this project is valid", async () => {
  resetAppCheckKeys();
  assert.equal(await checkAppCheck(await token(good), PROJECT, { now, fetchKeys: keys }), "valid");
});

test("an expired token, another project's token and a wrong audience are invalid", async () => {
  resetAppCheckKeys();
  assert.equal(await checkAppCheck(await token({ ...good, exp: now / 1000 - 1 }), PROJECT, { now, fetchKeys: keys }), "invalid");
  assert.equal(await checkAppCheck(await token({ ...good, iss: "https://firebaseappcheck.googleapis.com/999" }), PROJECT, { now, fetchKeys: keys }), "invalid");
  assert.equal(await checkAppCheck(await token({ ...good, aud: ["projects/999"] }), PROJECT, { now, fetchKeys: keys }), "invalid");
});

test("a token signed with some other key, or with an unknown key id, is invalid", async () => {
  resetAppCheckKeys();
  const other = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  assert.equal(await checkAppCheck(await token(good, {}, other.privateKey), PROJECT, { now, fetchKeys: keys }), "invalid");
  assert.equal(await checkAppCheck(await token(good, { kid: "nope" }), PROJECT, { now, fetchKeys: keys }), "invalid");
});

test("garbage and unsigned tokens are invalid", async () => {
  resetAppCheckKeys();
  assert.equal(await checkAppCheck("not.a.jwt", PROJECT, { now, fetchKeys: keys }), "invalid");
  assert.equal(await checkAppCheck(await token(good, { alg: "none" }), PROJECT, { now, fetchKeys: keys }), "invalid");
});

test("if Google's key list cannot be reached, the check is off for that request", async () => {
  resetAppCheckKeys();
  const down = async () => {
    throw new Error("offline");
  };
  assert.equal(await checkAppCheck(await token(good), PROJECT, { now, fetchKeys: down }), "off");
});

test("the log always says invalid, and repeats missing and valid at most once a minute", () => {
  const log = new AppCheckLog(60_000);
  assert.equal(log.shouldLog("off", "web", 0), false);
  assert.equal(log.shouldLog("invalid", "web", 0), true);
  assert.equal(log.shouldLog("invalid", "web", 1), true);
  assert.equal(log.shouldLog("valid", "web", 0), true);
  assert.equal(log.shouldLog("valid", "web", 30_000), false);
  assert.equal(log.shouldLog("valid", "android", 30_000), true);
  assert.equal(log.shouldLog("valid", "web", 60_001), true);
});
