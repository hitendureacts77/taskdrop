#!/usr/bin/env node
/**
 * Security round 1, test T5 (docs/ULTIMATE_PLAN.md task 2.7): can a stranger, or someone with only the
 * public key, open, list, replace or delete another person's private files?
 *
 * Runs against the STAGING project only (fake accounts, fake data), signing in as two seed people the way
 * the app does: the sign-in code comes back in the reply on staging (`dev_otp_for_all`).
 *
 *   node scripts/security-storage.mjs
 *
 * Needs the project's PUBLIC url and key (the same two values as the web build) in EXPO_PUBLIC_SUPABASE_URL
 * and EXPO_PUBLIC_SUPABASE_ANON_KEY. Writes nothing it does not remove again. Exit 1 if anything got through.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !KEY) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values).');
if (!URL.includes('wjxvingpfbfvkfqhrguj')) throw new Error('This test only runs against the staging project.');

const BUCKET = 'task-media';
const ASHA = '9990000001'; // poster, owns files
const MEERA = '9990000003'; // stranger

const headers = { apikey: KEY, 'Content-Type': 'application/json', 'x-taskdrop-platform': 'web', 'x-taskdrop-app-version': '1.0.0' };

async function signIn(phone) {
  const fn = (body) =>
    fetch(`${URL}/functions/v1/phone-auth`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) }).then((r) => r.json());
  const sent = await fn({ action: 'send', phone, mode: 'signin' });
  if (!sent.devCode) throw new Error(`no test code for ${phone}: ${JSON.stringify(sent).slice(0, 120)}`);
  const verified = await fn({ action: 'verify', phone, code: sent.devCode, mode: 'signin' });
  if (!verified.token_hash) throw new Error(`could not verify ${phone}`);
  const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.verifyOtp({ token_hash: verified.token_hash, type: 'magiclink' });
  if (error || !data.session) throw new Error(`session for ${phone}: ${error?.message}`);
  return { client, userId: data.session.user.id, token: data.session.access_token };
}

const findings = [];
const held = [];
const refused = (probe, ok, got) => (ok ? held.push(probe) : findings.push(`${probe} -> ${got}`));

const asha = await signIn(ASHA);
await new Promise((r) => setTimeout(r, 1500));
const meera = await signIn(MEERA);
const anon = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Asha puts a small private file in her own folder, so there is something to attack.
const path = `${asha.userId}/security-round1-probe.txt`;
const up = await asha.client.storage.from(BUCKET).upload(path, new Blob(['probe'], { type: 'text/plain' }), { upsert: true, contentType: 'text/plain' });
const ownUploadWorked = !up.error;
// Asha's own file type may be limited by the bucket's mime list; fall back to any real file she owns.
let target = ownUploadWorked ? path : null;
if (!target) {
  const own = await asha.client.storage.from(BUCKET).list(asha.userId, { limit: 5 });
  target = own.data?.[0] ? `${asha.userId}/${own.data[0].name}` : null;
}
if (!target) {
  console.log('T5: Asha has no file to attack and could not upload one; reads cannot be proved.', up.error?.message);
  process.exit(2);
}

// 1. A stranger tries to read it.
const dl = await meera.client.storage.from(BUCKET).download(target);
refused('stranger downloads another person\'s file', !!dl.error && !dl.data, dl.data ? 'got the file' : 'refused');
const sg = await meera.client.storage.from(BUCKET).createSignedUrl(target, 60);
refused('stranger asks for a signed link to it', !!sg.error || !sg.data?.signedUrl, 'got a link');

// 2. A stranger tries to list the folder.
const ls = await meera.client.storage.from(BUCKET).list(asha.userId, { limit: 50 });
refused('stranger lists another person\'s folder', !ls.error && (ls.data ?? []).length === 0, `${(ls.data ?? []).length} entries`);
const root = await meera.client.storage.from(BUCKET).list('', { limit: 100 });
refused('stranger lists the bucket root and sees other people\'s folders with files', !root.error && !(root.data ?? []).some((e) => e.name === asha.userId), 'saw the folder');

// 3. The public key alone.
const adl = await anon.storage.from(BUCKET).download(target);
refused('the public key alone downloads a file', !!adl.error && !adl.data, 'got the file');
const als = await anon.storage.from(BUCKET).list(asha.userId, { limit: 50 });
refused('the public key alone lists a folder', (als.data ?? []).length === 0, `${(als.data ?? []).length} entries`);
const pub = await fetch(`${URL}/storage/v1/object/public/${BUCKET}/${target}`);
refused('the "public" address of a private bucket serves the file', pub.status >= 400, `status ${pub.status}`);

// 4. Writing into, replacing or deleting someone else's folder.
const w = await meera.client.storage.from(BUCKET).upload(`${asha.userId}/planted-by-stranger.txt`, new Blob(['x'], { type: 'text/plain' }), { contentType: 'text/plain' });
refused('stranger uploads into another person\'s folder', !!w.error, 'upload accepted');
if (!w.error) await asha.client.storage.from(BUCKET).remove([`${asha.userId}/planted-by-stranger.txt`]);
const rp = await meera.client.storage.from(BUCKET).upload(target, new Blob(['overwritten'], { type: 'text/plain' }), { upsert: true, contentType: 'text/plain' });
refused('stranger overwrites another person\'s file', !!rp.error, 'overwrite accepted');
const rm = await meera.client.storage.from(BUCKET).remove([target]);
const still = await asha.client.storage.from(BUCKET).download(target);
refused('stranger deletes another person\'s file', !still.error, `the file is gone (remove said ${rm.error ? 'error' : 'ok'})`);

// 5. Path tricks.
for (const evil of [`../${asha.userId}/x`, `${meera.userId}/../${asha.userId}/${target.split('/')[1]}`, `%2e%2e/${target}`]) {
  const t = await meera.client.storage.from(BUCKET).download(evil);
  refused(`path trick ${evil.slice(0, 20)}…`, !!t.error && !t.data, 'got a file');
}

// Clean up what this run made.
if (ownUploadWorked) await asha.client.storage.from(BUCKET).remove([path]);

console.log(`T5 storage: ${held.length} probes held, ${findings.length} got through`);
for (const f of findings) console.log('  GOT THROUGH: ' + f);
process.exit(findings.length ? 1 : 0);
