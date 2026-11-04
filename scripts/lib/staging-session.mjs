// Signs a seed person in on the STAGING project the way the app does, for the security scripts
// (scripts/security-storage.mjs, scripts/security-round2.mjs). Never used against anything else.
//
// On staging the sign-in code comes back in the reply (`dev_otp_for_all`); this is refused for any other project.
import { createClient } from '@supabase/supabase-js';

export const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !KEY) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values).');
// The whole host must be staging's: a substring test would let `https://wjxvingpfbfvkfqhrguj.evil.example` through.
if (new globalThis.URL(URL).hostname !== 'wjxvingpfbfvkfqhrguj.supabase.co') throw new Error('These tests only run against the staging project.');

export const headers = { apikey: KEY, 'Content-Type': 'application/json', 'x-taskdrop-platform': 'web', 'x-taskdrop-app-version': '1.0.0' };

export const phoneAuth = (body, extra = {}) =>
  fetch(`${URL}/functions/v1/phone-auth`, {
    method: 'POST',
    headers: { ...headers, Authorization: `Bearer ${KEY}`, ...extra },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

/** Waits out the one-code-a-minute cooldown when the number was used a moment ago. */
export async function signIn(phone) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const sent = await phoneAuth({ action: 'send', phone, mode: 'signin' });
    if (sent.body.devCode) {
      const verified = await phoneAuth({ action: 'verify', phone, code: sent.body.devCode, mode: 'signin' });
      if (!verified.body.token_hash) throw new Error(`could not verify ${phone}`);
      const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.auth.verifyOtp({ token_hash: verified.body.token_hash, type: 'magiclink' });
      if (error || !data.session) throw new Error(`session for ${phone}: ${error?.message}`);
      return { client, userId: data.session.user.id, token: data.session.access_token };
    }
    if (sent.status !== 429) throw new Error(`no test code for ${phone}: ${JSON.stringify(sent.body).slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 61_000));
  }
  throw new Error(`could not sign in ${phone}`);
}

/** One call to the app's single door, as a signed-in person. Never throws. */
export async function api(token, op, args = {}) {
  try {
    const res = await fetch(`${URL}/functions/v1/api`, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ op, args }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: String(e) };
  }
}
