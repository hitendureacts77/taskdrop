// node --test scripts/check-gateway-only.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_SRC, bypassesIn, scanApp } from './check-gateway-only.mjs';

const whys = (path, text) => bypassesIn(path, text).map((b) => b.why);

test('the app today goes through the gateway only', () => {
  assert.deepEqual(scanApp(APP_SRC), []);
});

test('a direct table read, database function or Storage call is a bypass', () => {
  assert.equal(whys('data/x.ts', "await supabase.from('settings').select('*')").length, 1);
  assert.equal(whys('data/x.ts', "await supabase\n  .from('tasks')\n  .select('id')").length, 1);
  assert.ok(whys('data/x.ts', "await supabase.rpc('get_wallet')").length >= 1);
  assert.equal(whys('data/x.ts', "await supabase.storage.from('task-media').upload(p, f)").length, 1);
  assert.equal(bypassesIn('data/x.ts', "const a = 1;\nawait supabase.from('t')")[0].line, 2);
});

test('raw service addresses and table-change feeds are bypasses', () => {
  assert.equal(whys('lib/x.ts', 'fetch(`${base}/rest/v1/tasks`)').length, 1);
  assert.equal(whys('lib/x.ts', 'fetch(`${base}/storage/v1/object/x`)').length, 1);
  assert.ok(whys('lib/live.ts', "ch.on('postgres_changes', { table: 'messages' }, cb)").length === 1);
});

test('only the listed server functions may be called', () => {
  assert.deepEqual(whys('lib/x.ts', "supabase.functions.invoke('api', { body })"), []);
  assert.deepEqual(whys('lib/x.ts', 'fetch(`${base}/functions/v1/app-config?${q}`)'), []);
  assert.equal(whys('lib/x.ts', "supabase.functions.invoke('razorpayx-payouts', { body })").length, 1);
  assert.equal(whys('lib/x.ts', 'fetch(`${base}/functions/v1/inngest`)').length, 1);
});

test('one client file and one live file', () => {
  assert.deepEqual(whys('lib/supabase.ts', 'export const supabase = createClient(url, key)'), []);
  assert.equal(whys('screens/X.tsx', 'const c = createClient(url, key)').length, 1);
  assert.deepEqual(whys('lib/live.ts', "supabase.channel(`user:${uid}`, { config: { private: true } })"), []);
  assert.equal(whys('screens/X.tsx', "supabase.channel('room')").length, 1);
});

test('Array.from and friends are not database calls', () => {
  assert.deepEqual(whys('lib/x.ts', 'Array.from(set); Buffer.from(s); AsyncStorage.getItem(k)'), []);
});
