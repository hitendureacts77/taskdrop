#!/usr/bin/env node
/**
 * Payment preflight.
 *
 * Answers, in one command, the three questions that decide whether TaskDrop can
 * take money today:
 *
 *   1. Are the Razorpay API keys set as Edge Function secrets?
 *   2. Is the webhook reachable, i.e. is JWT verification off for it?
 *   3. Is the webhook secret set?
 *
 * It sends no money and needs no credentials of its own — it reads the status
 * codes the functions already return. Run it after each setup step; the output
 * tells you which step you are on.
 *
 *   node scripts/check-payments.mjs
 */

import { readFileSync } from 'node:fs';

const PROJECT = process.env.SUPABASE_PROJECT_REF ?? 'wjxvingpfbfvkfqhrguj';

/**
 * The publishable anon key, so the platform gateway lets a request reach the
 * function. Without it every call returns 401 at the edge and we cannot tell a
 * missing session from missing Razorpay keys.
 */
function anonKey() {
  if (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) return process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  for (const f of ['apps/mobile/.env', '.env']) {
    try {
      const line = readFileSync(f, 'utf8')
        .split(String.fromCharCode(10))
        .find((l) => l.startsWith('EXPO_PUBLIC_SUPABASE_ANON_KEY='));
      if (line) return line.slice(line.indexOf('=') + 1).trim();
    } catch {
      /* try the next one */
    }
  }
  return null;
}
const ANON = anonKey();
const BASE = `https://${PROJECT}.supabase.co/functions/v1`;

const ok = (m) => console.log('  \x1b[32mPASS\x1b[0m  ' + m);
const bad = (m) => console.log('  \x1b[31mFAIL\x1b[0m  ' + m);
const info = (m) => console.log('        ' + m);

async function post(path, body, headers = {}) {
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    let parsed = null;
    const text = await res.text();
    try {
      parsed = JSON.parse(text);
    } catch {
      /* some failures are not JSON */
    }
    return { status: res.status, body: parsed, text };
  } catch (e) {
    return { status: 0, body: null, text: String(e) };
  }
}

console.log(`\nPayment preflight for ${PROJECT}\n`);
let failures = 0;

// ---- 1. the webhook endpoint -----------------------------------------------
console.log('Webhook endpoint');
{
  const r = await post('razorpay-webhook', {});

  if (r.status === 401 && r.body?.error === 'Bad signature') {
    ok('reachable, and it is checking signatures');
  } else if (r.status === 401) {
    bad('JWT verification is still ON — Razorpay will never reach it');
    info('Fix: npx supabase functions deploy razorpay-webhook --project-ref ' + PROJECT);
    info('or:  Dashboard → Edge Functions → razorpay-webhook → uncheck "Verify JWT"');
    failures++;
  } else if (r.status === 503) {
    bad('RAZORPAY_WEBHOOK_SECRET is not set');
    info('Fix: npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=<long random string> --project-ref ' + PROJECT);
    failures++;
  } else if (r.status === 404) {
    bad('not deployed');
    failures++;
  } else {
    bad(`unexpected ${r.status}: ${r.text.slice(0, 120)}`);
    failures++;
  }
}

// ---- 2. the API keys --------------------------------------------------------
console.log('\nRazorpay API keys');
{
  if (!ANON) {
    info('skipped: no EXPO_PUBLIC_SUPABASE_ANON_KEY found, so the gateway would');
    info('reject this before the function could answer.');
  }
  // With the anon key the gateway passes us through, so the response is the
  // function's own: 503 means Razorpay is unconfigured, 401 "Sign in first"
  // means it is configured and simply wants a real user.
  const r = ANON
    ? await post(
        'razorpay',
        { action: 'create-link', purpose: 'topup', amountMinor: 100 },
        { Authorization: `Bearer ${ANON}`, apikey: ANON },
      )
    : null;

  if (!r) {
    failures++;
  } else if (r.status === 503 && r.body?.configured === false) {
    bad('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set');
    info('Fix: npx supabase secrets set RAZORPAY_KEY_ID=rzp_live_xxx RAZORPAY_KEY_SECRET=xxx --project-ref ' + PROJECT);
    failures++;
  } else if (r.status === 401 && /sign in/i.test(r.text)) {
    ok('keys are set — the function got past its own config check');
  } else if (r.status === 401) {
    bad('rejected at the gateway, so this tells us nothing about the keys');
    info('Check EXPO_PUBLIC_SUPABASE_ANON_KEY is the current publishable key.');
    failures++;
  } else if (r.status === 404) {
    bad('razorpay function is not deployed');
    failures++;
  } else {
    info(`ambiguous ${r.status}: ${r.text.slice(0, 120)}`);
  }
}

console.log(
  failures === 0
    ? '\nReady to take payments. Run a real ₹1 payment and confirm it settles without anyone tapping anything.\n'
    : `\n${failures} thing${failures === 1 ? '' : 's'} left. See docs/GOING_LIVE.md.\n`,
);
process.exit(failures === 0 ? 0 : 1);
