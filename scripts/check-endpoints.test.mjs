// node --test scripts/check-endpoints.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { FUNCTIONS_DIR, problemsFor, readConfig, scanFunctions } from './check-endpoints.mjs';

const config = '[functions.api]\nverify_jwt = true\n\n[functions.app-config]\nverify_jwt = false\n';

test('every server function today has a lock and a limit, or a reason', () => {
  assert.deepEqual(scanFunctions(FUNCTIONS_DIR, readConfig()), []);
});

test('a function that is on no list fails', () => {
  const p = problemsFor('brand-new', 'Deno.serve(() => new Response("hi"))', config);
  assert.equal(p.length, 1);
  assert.match(p[0], /not on the list/);
});

test('a login function needs the caller check and the limit', () => {
  const both = 'await admin.auth.getUser(jwt); import { withinRate } from "../_shared/rateLimit.ts";';
  assert.deepEqual(problemsFor('razorpayx-payouts', both, config), []);
  assert.equal(problemsFor('razorpayx-payouts', 'await admin.auth.getUser(jwt);', config).length, 1);
  assert.equal(problemsFor('razorpayx-payouts', 'import { withinRate } from "../_shared/rateLimit.ts";', config).length, 1);
  assert.equal(problemsFor('razorpayx-payouts', '', config).length, 2);
});

test('the places search keeps counting its quota', () => {
  assert.deepEqual(problemsFor('places-search', 'auth.getUser(); admin.rpc("take_places_quota")', config), []);
});

test('a login function may not be switched to public in the config', () => {
  const both = 'await admin.auth.getUser(jwt); api_rate_hit';
  assert.equal(problemsFor('api', both, '[functions.api]\nverify_jwt = false\n').length, 1);
  assert.deepEqual(problemsFor('api', both, config), []);
});

test('a webhook needs its signature check', () => {
  assert.deepEqual(problemsFor('razorpay-webhook', 'req.headers.get("x-razorpay-signature")', config), []);
  assert.equal(problemsFor('razorpay-webhook', 'return json({ ok: true })', config).length, 1);
  assert.equal(problemsFor('inngest', 'serve({ client })', config).length, 1);
});

test('the sign-in functions need their own limits', () => {
  assert.deepEqual(problemsFor('phone-auth', 'admin.rpc("hit_auth_send_ip")', config), []);
  assert.equal(problemsFor('password-auth', 'signIn()', config).length, 1);
});
