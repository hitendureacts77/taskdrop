// node --test scripts/check-endpoints.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { FUNCTIONS_DIR, GUEST_TESTS, problemsFor, readConfig, scanFunctions } from './check-endpoints.mjs';

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
  assert.equal(problemsFor('places-search', both, '[functions.places-search]\nverify_jwt = false\n').length, 1);
  assert.deepEqual(problemsFor('places-search', both, config), []);
});

test('the api also keeps its guest door: exact public key, its own bounded limit, and the read-only tests', () => {
  const door = 'await db.auth.getClaims(jwt); api_rate_spend; isGuestToken(jwt, anonKey, c); rpc("api_guest_spend"); new GuestLocalLimit()';
  const tests = GUEST_TESTS.join('\n');
  assert.deepEqual(problemsFor('api', door, config, tests), []);
  assert.equal(problemsFor('api', door, '[functions.api]\nverify_jwt = false\n', tests).length, 1);
  assert.equal(problemsFor('api', door.replace('GuestLocalLimit', 'Nothing'), config, tests).length, 1, 'a limiter that fails open');
  assert.equal(problemsFor('api', door.replace('api_guest_spend', 'nothing'), config, tests).length, 1);
  assert.equal(problemsFor('api', door.replace('isGuestToken', 'anyToken'), config, tests).length, 1);
  assert.equal(problemsFor('api', door, config, tests.split('\n').slice(1).join('\n')).length, 1, 'a guest read-only test was removed');
  assert.equal(problemsFor('api', door, config).length, GUEST_TESTS.length);
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
