/**
 * Tests for the ImageKit helpers. Run from the repo root:
 *   node --experimental-strip-types --test supabase/functions/_shared/imagekit.test.ts
 *
 * The expected signatures are computed with Node's own crypto, a different
 * implementation from the Web Crypto the helpers use, so a mistake in what is
 * signed (not just in how) shows up.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  configFrom, deleteFile, fileDetails, findFileId, hmacSha1Hex, type ImageKitConfig, signedUrl, transformationFor,
  uploadAuth, urlExpiry, userFolder,
} from "./imagekit.ts";

// Made-up keys for the test only; they open nothing.
const cfg: ImageKitConfig = {
  publicKey: "public_testkey",
  privateKey: "private_testkey",
  urlEndpoint: "https://ik.imagekit.io/demo",
  env: "local",
};
const UID = "11111111-1111-4111-8111-111111111111";
const node = (key: string, msg: string) => createHmac("sha1", key).update(msg).digest("hex");

test("HMAC-SHA1 matches Node's, in lowercase hex", async () => {
  assert.equal(await hmacSha1Hex("k", "message"), node("k", "message"));
  assert.match(await hmacSha1Hex("k", "message"), /^[0-9a-f]{40}$/);
});

test("an upload is signed over token + expire and lasts under an hour", async () => {
  const now = Date.UTC(2026, 9, 19, 10, 0, 0);
  const a = await uploadAuth(cfg, now, "tok-123");
  assert.equal(a.token, "tok-123");
  assert.equal(a.expire, now / 1000 + 30 * 60);
  assert.equal(a.signature, node(cfg.privateKey, `tok-123${a.expire}`));
  assert.ok(a.expire - now / 1000 < 60 * 60, "ImageKit rejects an expiry an hour or more away");
  const b = await uploadAuth(cfg, now);
  assert.notEqual(b.token, a.token, "every upload gets its own token");
});

test("a picture's URL is signed over the part after the endpoint plus the expiry", async () => {
  const now = Date.UTC(2026, 9, 19, 10, 30, 0);
  const path = `/local/u/${UID}/abc.jpg`;
  const url = await signedUrl(cfg, path, "card", now);
  const expiry = urlExpiry(now);
  const rest = `tr:w-640,h-640,c-at_max,q-80,f-auto${path}`;
  assert.equal(url, `https://ik.imagekit.io/demo/${rest}?ik-t=${expiry}&ik-s=${node(cfg.privateKey, `${rest}${expiry}`)}`);
});

test("the endpoint's trailing slash and the path's missing leading slash change nothing", async () => {
  const now = Date.UTC(2026, 9, 19, 10, 0, 0);
  const a = await signedUrl(cfg, "/local/u/x/a.jpg", "thumb", now);
  const b = await signedUrl({ ...cfg, urlEndpoint: "https://ik.imagekit.io/demo/" }, "local/u/x/a.jpg", "thumb", now);
  assert.equal(a, b);
});

test("every request in the same clock hour gets the same URL, valid for between one and two hours", async () => {
  const hour = Date.UTC(2026, 9, 19, 10, 0, 0);
  const early = hour + 1000;
  const late = hour + 59 * 60 * 1000;
  assert.equal(await signedUrl(cfg, "/a.jpg", "full", early), await signedUrl(cfg, "/a.jpg", "full", late));
  assert.notEqual(await signedUrl(cfg, "/a.jpg", "full", late), await signedUrl(cfg, "/a.jpg", "full", late + 2 * 60 * 1000));
  for (const t of [early, late]) {
    const left = urlExpiry(t) - t / 1000;
    assert.ok(left >= 3600 && left <= 7200, `${left}s left`);
  }
});

test("each size is a different, fitted transformation", () => {
  assert.notEqual(transformationFor("thumb"), transformationFor("card"));
  assert.match(transformationFor("full"), /^tr:w-1600,h-1600,c-at_max/);
});

test("unusual characters in a path are encoded before signing", async () => {
  const url = await signedUrl(cfg, "/local/u/x/a b.jpg", "thumb", Date.UTC(2026, 9, 19));
  assert.match(url, /\/a%20b\.jpg\?ik-t=/);
});

test("a person's folder is under the environment and their own id", () => {
  assert.equal(userFolder(cfg, UID), `/local/u/${UID}`);
});

test("settings are read from secrets, and are null unless all the real ones are present", async () => {
  const all: Record<string, string> = {
    IMAGEKIT_PUBLIC_KEY: "public_x", IMAGEKIT_PRIVATE_KEY: "private_x", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/demo/", IMAGEKIT_ENV: "beta",
  };
  const get = (o: Record<string, string>) => async (n: string) => o[n] ?? "";
  assert.deepEqual(await configFrom(get(all)), {
    publicKey: "public_x", privateKey: "private_x", urlEndpoint: "https://ik.imagekit.io/demo", env: "beta",
  });
  assert.equal((await configFrom(get({ ...all, IMAGEKIT_ENV: "" })))?.env, "local");
  assert.equal(await configFrom(get({ ...all, IMAGEKIT_PRIVATE_KEY: "" })), null);
  assert.equal(await configFrom(get({ ...all, IMAGEKIT_URL_ENDPOINT: "http://example.com/x" })), null);
  assert.equal(await configFrom(get({ ...all, IMAGEKIT_ENV: "../prod" })), null);
});

// -------------------------------------------------------------------- the API --

type Call = { url: string; method: string; auth: string | undefined };
function fakeFetch(answer: (url: string, method: string) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const f = async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, auth: init?.headers?.Authorization });
    const r = answer(url, method);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { f, calls };
}

test("file details are asked with the private key as the basic-auth user; a 404 is null", async () => {
  const ok = fakeFetch(() => ({ status: 200, body: { fileId: "f1", filePath: "/local/u/x/a.jpg", fileType: "image", size: 10, isPrivateFile: true } }));
  assert.equal((await fileDetails(cfg, ok.f, "f1"))?.filePath, "/local/u/x/a.jpg");
  assert.equal(ok.calls[0].url, "https://api.imagekit.io/v1/files/f1/details");
  assert.equal(ok.calls[0].auth, `Basic ${Buffer.from(`${cfg.privateKey}:`).toString("base64")}`);
  assert.equal(await fileDetails(cfg, fakeFetch(() => ({ status: 404 })).f, "f1"), null);
  await assert.rejects(fileDetails(cfg, fakeFetch(() => ({ status: 500 })).f, "f1"), /HTTP 500/);
});

test("deleting a file that is already gone counts as deleted; any other failure is thrown", async () => {
  const gone = fakeFetch(() => ({ status: 404 }));
  await deleteFile(cfg, gone.f, "f1");
  assert.equal(gone.calls[0].method, "DELETE");
  await deleteFile(cfg, fakeFetch(() => ({ status: 204 })).f, "f1");
  await assert.rejects(deleteFile(cfg, fakeFetch(() => ({ status: 429 })).f, "f1"), /HTTP 429/);
});

test("a never-attached picture is found by its exact path", async () => {
  const path = `/local/u/${UID}/abc.jpg`;
  const hit = fakeFetch(() => ({ status: 200, body: [{ fileId: "other", filePath: `/local/u/${UID}/abc.jpg.bak` }, { fileId: "f9", filePath: path }] }));
  assert.equal(await findFileId(cfg, hit.f, path), "f9");
  const q = new URL(hit.calls[0].url);
  assert.equal(q.searchParams.get("path"), `/local/u/${UID}`);
  assert.match(q.searchParams.get("searchQuery") ?? "", /name = "abc\.jpg"/);
  assert.equal(await findFileId(cfg, fakeFetch(() => ({ status: 200, body: [] })).f, path), null);
});
