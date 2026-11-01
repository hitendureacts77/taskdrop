#!/usr/bin/env node
/**
 * Security round 2 (docs/ULTIMATE_PLAN.md task 2.9), the parts that can run without a phone:
 *
 *   T4  Hostile input. Every operation of the app's single door (`api`) is sent hostile text (script code,
 *       database tricks, a huge value, a null byte, odd unicode, template strings, nested objects, wrong
 *       types). The server must answer with a clean refusal or accept it as plain text: never a server error,
 *       never a database message, a table name or a stack trace.
 *   T6  Sign-in tricks. Guessing a code, resending to get more guesses, malformed phone numbers, and what the
 *       error messages say about whether an account exists.
 *
 * STAGING only (fake accounts, fake money). Run:
 *
 *   node scripts/security-round2.mjs          # both
 *   node scripts/security-round2.mjs fuzz     # T4 only
 *   node scripts/security-round2.mjs signin   # T6 only
 *
 * Needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values). Exit 1 if anything got through.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api, phoneAuth, signIn } from './lib/staging-session.mjs';

const which = process.argv[2] ?? 'all';
const root = fileURLToPath(new URL('..', import.meta.url));
const findings = [];
let held = 0;
const ok = (probe) => held++;
const bad = (area, probe, got) => findings.push(`[${area}] ${probe} -> ${got}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// What a clean answer must never contain: database, runtime or path details.
const LEAK = /syntax error|violates|relation "|column "|pg_catalog|postgres|PGRST|supabase\.co|stack|at file:|\.ts:\d+|deno|TypeError|ReferenceError|SELECT |INSERT |auth\.users|service_role|JWT/i;

// ------------------------------------------------------------------------------------ T4
async function fuzz() {
  const meera = await signIn('9990000003');

  const names = new Set();
  for (const f of ['reads.ts', 'writes.ts', 'media.ts']) {
    const src = readFileSync(`${root}supabase/functions/api/${f}`, 'utf8');
    for (const m of src.matchAll(/^ {2}([a-z][A-Za-z]+):\s/gm)) names.add(m[1]);
  }
  // Not fuzzed: deleting the account that is being used to test, and signing out.
  for (const skip of ['deleteMyAccount']) names.delete(skip);
  if (names.size < 40) throw new Error(`only found ${names.size} operations; the source layout changed`);

  const KEYS = [
    'taskId', 'bidId', 'userId', 'payoutId', 'ticketId', 'promotionId', 'mediaId', 'id', 'title', 'description', 'message', 'comment', 'reason', 'note',
    'name', 'displayName', 'username', 'bio', 'address', 'body', 'label', 'code', 'category', 'upi', 'upiId', 'amountMinor', 'priceMinor', 'rating',
    'page', 'limit', 'query', 'q', 'type', 'target', 'kind', 'status', 'role', 'token', 'platform', 'installId', 'path', 'url', 'phone', 'email',
  ];
  const PAYLOADS = [
    ['script', '<script>alert(1)</script><img src=x onerror=alert(1)>'],
    ['sql', "'; drop table public.profiles; --"],
    ['sql-or', '" OR 1=1 --'],
    ['null-byte', 'a\u0000b\u0000'],
    ['unicode', '‮😀\u0000﻿​' + 'é'.repeat(50)],
    ['template', '${7*7}{{7*7}}<%= 7*7 %>'],
    ['traversal', '../../../../etc/passwd'],
    ['huge', 'A'.repeat(200_000)],
    ['big-number', 9e99],
    ['negative', -1],
    ['nested', { a: { b: { c: [[[[1]]]] } } }],
    ['array', ['x', 1, null]],
  ];

  let calls = 0;
  const started = Date.now();
  for (const op of [...names].sort()) {
    const isRead = /^(get|list|count|platform|search|can|my|is|age)/.test(op);
    // 60 writes a minute per person: write operations get fewer payloads and are paced.
    const payloads = isRead ? PAYLOADS : PAYLOADS.slice(0, 6);
    const probes = [['empty', {}], ...payloads.map(([n, v]) => [n, Object.fromEntries(KEYS.map((k) => [k, v]))])];
    for (const [pname, args] of probes) {
      if (!isRead) await wait(1100);
      const r = await api(meera.token, op, args);
      calls++;
      const label = `${op} with ${pname}`;
      if (r.status === 429) {
        await wait(15_000); // the limiter holding is fine; slow down and carry on
        ok(label);
        continue;
      }
      if (r.status >= 500) bad('T4', label, `HTTP ${r.status}`);
      else if (/^s*<!DOCTYPE html/i.test(r.text) && /cloudflare|cf-|Attention Required|Sorry, you have been blocked/i.test(r.text)) ok(label + ' (stopped by the firewall before the app)');
      else if (!r.json || typeof r.json !== 'object' || !('ok' in r.json)) bad('T4', label, `not the app's answer: ${r.text.slice(0, 80)}`);
      else if (r.json.ok === false && (r.json.error?.code === 'INTERNAL' || LEAK.test(String(r.json.error?.message ?? '')))) {
        bad('T4', label, `the refusal says too much: ${String(r.json.error?.message).slice(0, 100)}`);
      } else ok(label);
    }
  }
  console.log(`T4 hostile input: ${calls} calls across ${names.size} operations in ${Math.round((Date.now() - started) / 1000)}s`);

  // The same payloads, straight to the door in other shapes.
  const raw = async (probe, init) => {
    const r = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/api`, init).catch((e) => ({ status: 0, text: async () => String(e) }));
    const text = await r.text();
    if (r.status >= 500) bad('T4', probe, `HTTP ${r.status}`);
    else if (LEAK.test(text)) bad('T4', probe, `leaks: ${text.slice(0, 100)}`);
    else ok(probe);
  };
  const auth = { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${meera.token}`, 'Content-Type': 'application/json' };
  await raw('operation name is a script', { method: 'POST', headers: auth, body: JSON.stringify({ op: '<script>alert(1)</script>', args: {} }) });
  await raw('operation name is __proto__', { method: 'POST', headers: auth, body: JSON.stringify({ op: '__proto__', args: {} }) });
  await raw('operation name is constructor', { method: 'POST', headers: auth, body: JSON.stringify({ op: 'constructor', args: {} }) });
  await raw('args is a string', { method: 'POST', headers: auth, body: JSON.stringify({ op: 'getWallet', args: 'x' }) });
  await raw('prototype pollution in args', { method: 'POST', headers: auth, body: '{"op":"updateProfile","args":{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}}' });
  await raw('deeply nested json', { method: 'POST', headers: auth, body: '{"op":"getWallet","args":' + '['.repeat(5000) + ']'.repeat(5000) + '}' });
  await raw('wrong content type', { method: 'POST', headers: { ...auth, 'Content-Type': 'text/plain' }, body: 'op=getWallet' });
  await raw('GET instead of POST', { method: 'GET', headers: auth });
  await raw('PUT instead of POST', { method: 'PUT', headers: auth, body: '{}' });
}

// ------------------------------------------------------------------------------------ T6
async function signinTricks() {
  const phone = '9990000003'; // a seed account (Meera); the probes only touch her sign-in code
  const fresh = async () => {
    for (let i = 0; i < 3; i++) {
      const s = await phoneAuth({ action: 'send', phone, mode: 'signin' });
      if (s.body.devCode) return s.body.devCode;
      if (s.status !== 429) return null;
      await wait(61_000);
    }
    return null;
  };

  // Malformed numbers are refused before anything is sent.
  for (const p of ['', '123', '98765abcde', "9876543210'; drop table x;--", '+1 202 555 0100', '0000000000', '9999999999', '5876543210', 'a'.repeat(5000)]) {
    const r = await phoneAuth({ action: 'send', phone: p, mode: 'signin' });
    if (r.status === 200 && r.body.ok) bad('T6', `a code was sent to "${p.slice(0, 20)}"`, JSON.stringify(r.body).slice(0, 80));
    else if (r.status >= 500) bad('T6', `malformed number "${p.slice(0, 20)}"`, `HTTP ${r.status}`);
    else ok(`refused ${p.slice(0, 20)}`);
  }

  // Guessing: five wrong tries use up the code; the right code afterwards is refused too.
  const code = await fresh();
  if (!code) {
    bad('T6', 'could not get a code to test guessing with', 'skipped');
  } else {
    const wrong = code === '000000' ? '111111' : '000000';
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) lastStatus = (await phoneAuth({ action: 'verify', phone, code: wrong, mode: 'signin' })).status;
    const right = await phoneAuth({ action: 'verify', phone, code, mode: 'signin' });
    if (right.body.token_hash) bad('T6', 'the right code worked after 6 wrong guesses', 'signed in');
    else ok('guess budget holds');
    if (lastStatus < 400) bad('T6', 'a wrong code was accepted', `HTTP ${lastStatus}`);
  }

  // A resend must not give a fresh set of guesses (the budget carries across a resend).
  const code2 = await fresh();
  if (code2) {
    const wrong = code2 === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) await phoneAuth({ action: 'verify', phone, code: wrong, mode: 'signin' });
    const code3 = await fresh(); // waits out the one-a-minute cooldown
    if (code3) {
      for (let i = 0; i < 3; i++) await phoneAuth({ action: 'verify', phone, code: wrong, mode: 'signin' });
      const r = await phoneAuth({ action: 'verify', phone, code: code3, mode: 'signin' });
      if (r.body.token_hash) bad('T6', 'alternating resend and guess gave a fresh set of guesses', 'signed in after 6 wrong guesses in one window');
      else ok('resend does not reset guesses');
    }
  }

  // A code is single use.
  await wait(61_000);
  const c = await fresh();
  if (c) {
    const first = await phoneAuth({ action: 'verify', phone, code: c, mode: 'signin' });
    const second = await phoneAuth({ action: 'verify', phone, code: c, mode: 'signin' });
    if (first.body.token_hash && second.body.token_hash) bad('T6', 'a sign-in code worked twice', 'two sessions from one code');
    else ok('a code is single use');
  }

  // What the messages say about whether an account exists. Recorded, not failed: the screen needs to send people to the
  // right door ("sign in" vs "create account"), so these differ on purpose; the per-address budget limits how fast numbers can be tried.
  const unknown = await phoneAuth({ action: 'send', phone: '6000000001', mode: 'signin' });
  const known = await phoneAuth({ action: 'send', phone, mode: 'signup' });
  console.log(
    `T6 account-exists messages: unknown number says ${unknown.status} "${String(unknown.body.error).slice(0, 50)}"; ` +
      `known number says ${known.status} "${String(known.body.error).slice(0, 50)}"`,
  );

  // The public key alone, and tokens that are not real.
  for (const [label, token] of [['no token', ''], ['garbage token', 'not.a.jwt'], ['the public key as a token', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY]]) {
    const r = await api(token, 'getWallet');
    if (r.json?.ok === true) bad('T6', `${label} read a wallet`, 'ok');
    else ok(label);
  }
}

if (which === 'all' || which === 'fuzz') await fuzz();
if (which === 'all' || which === 'signin') await signinTricks();

console.log(`security round 2: ${held} probes held, ${findings.length} got through`);
for (const f of findings.slice(0, 60)) console.log('  GOT THROUGH: ' + f);
process.exit(findings.length ? 1 : 0);
