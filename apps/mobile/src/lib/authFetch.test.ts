/**
 * Tests for keeping a session when a renewal hits Supabase's sign-in limit (task 2.8b). Run from the repo root:
 *   node --experimental-strip-types --test apps/mobile/src/lib/authFetch.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { keepSessionOnRateLimit } from './authFetch.ts';

const answering = (status: number) => (async () => new Response('{"code":"over_request_rate_limit"}', { status })) as typeof fetch;
const REFRESH_URL = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';

test('a 429 on a session renewal becomes a 503, so supabase-js retries instead of signing out', async () => {
  const res = await keepSessionOnRateLimit(answering(429))(REFRESH_URL, { method: 'POST' });
  assert.equal(res.status, 503);
  assert.equal(await res.text(), '{"code":"over_request_rate_limit"}');
});

test('the URL can arrive as a URL object or a Request', async () => {
  const f = keepSessionOnRateLimit(answering(429));
  assert.equal((await f(new URL(REFRESH_URL))).status, 503);
  assert.equal((await f(new Request(REFRESH_URL, { method: 'POST' }))).status, 503);
});

test('a 429 on a sign-in (password, code check) stays a 429, so the person is told to wait', async () => {
  const f = keepSessionOnRateLimit(answering(429));
  assert.equal((await f('https://x.supabase.co/auth/v1/token?grant_type=password')).status, 429);
  assert.equal((await f('https://x.supabase.co/auth/v1/verify')).status, 429);
});

test('other answers to a renewal pass through, including a real refusal', async () => {
  assert.equal((await keepSessionOnRateLimit(answering(200))(REFRESH_URL)).status, 200);
  assert.equal((await keepSessionOnRateLimit(answering(400))(REFRESH_URL)).status, 400);
});
