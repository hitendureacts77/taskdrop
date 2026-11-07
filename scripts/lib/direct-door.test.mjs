// node --test scripts/lib/direct-door.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  describeRequest, judge, noSuchColumn, parseTableList, readRequest, refused, summarise, tablesFromMigrations, targetRefusal,
} from './direct-door.mjs';

const STAGING = 'https://wjxvingpfbfvkfqhrguj.supabase.co';
const ID = '11111111-2222-3333-4444-555555555555';

test('the target guard accepts only the staging project', () => {
  assert.equal(targetRefusal(STAGING), null);
  assert.match(targetRefusal(undefined), /not set/);
  assert.match(targetRefusal('https://taskdrop.in'), /production/);
  assert.match(targetRefusal('https://admin.taskdrop.in'), /production/);
  assert.match(targetRefusal('https://other.supabase.co'), /not the staging project/);
  assert.match(targetRefusal('https://wjxvingpfbfvkfqhrguj.supabase.co.evil.example'), /not the staging project/);
  assert.match(targetRefusal('nonsense'), /not a URL/);
});

test('the table list is read from the migrations and includes the sensitive tables', () => {
  const t = tablesFromMigrations();
  for (const n of ['wallets', 'payout_destinations', 'payout_profiles', 'task_private', 'profile_private', 'age_checks', 'user_roles', 'admin_staff', 'settings', 'app_controls', 'auth_codes', 'push_tokens', 'admin_audit_log']) {
    assert.ok(t.includes(n), `${n} missing from the list`);
  }
});

test('a table list file is parsed and a bad name is refused', () => {
  assert.deepEqual(parseTableList('# c\nwallets\n\nbids # x\nwallets\n'), ['bids', 'wallets']);
  assert.throws(() => parseTableList('wallets; drop table x'), /not a table name/);
});

test('the only request built is a GET of a count under /rest/v1/ and bad input throws', () => {
  const r = readRequest(STAGING, 'wallets', 'user_id', ID);
  assert.equal(r.method, 'GET');
  assert.equal(r.path, `/rest/v1/wallets?select=user_id&user_id=eq.${ID}&limit=0`);
  assert.equal(readRequest(STAGING, 'settings', null, null).path, '/rest/v1/settings?select=*&limit=0');
  assert.throws(() => readRequest(STAGING, 'wallets?x=1', 'user_id', ID));
  assert.throws(() => readRequest(STAGING, 'wallets', 'user_id', 'not-an-id'));
});

test('the script itself never sends a write', () => {
  const src = readFileSync(new URL('../direct-door-test.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/);
  assert.doesNotMatch(src, /\/rpc\//);
});

test('summaries keep a count and an error code, never a body', () => {
  assert.deepEqual(summarise(200, '', '*/7'), { status: 200, code: null, count: 7 });
  assert.deepEqual(summarise(206, '', '0-0/12'), { status: 206, code: null, count: 12 });
  assert.deepEqual(summarise(403, '{"code":"42501","message":"secret words"}', null), { status: 403, code: '42501', count: null });
  assert.ok(noSuchColumn(summarise(400, '{"code":"42703"}', null)));
  assert.ok(refused({ status: 401 }) && refused({ status: 404 }) && !refused({ status: 200 }));
});

test('verdicts: signed out must read nothing', () => {
  const j = (summary) => judge({ who: 'signed-out', table: 'wallets', kind: 'owner', summary });
  assert.equal(j({ status: 401, code: '42501', count: null }).verdict, 'ok');
  assert.equal(j({ status: 200, code: null, count: 0 }).verdict, 'ok');
  assert.equal(j({ status: 200, code: null, count: 1 }).verdict, 'fail');
});

test('verdicts: person A and B\'s rows', () => {
  const j = (table, kind, count) => judge({ who: 'person-a', table, kind, summary: { status: 200, code: null, count } });
  assert.equal(j('wallets', 'owner', 0).verdict, 'ok');
  assert.equal(j('wallets', 'owner', 1).verdict, 'fail');
  assert.equal(j('profiles', 'owner', 1).verdict, 'by-design');
  assert.equal(j('admin_audit_log', 'global', 1).verdict, 'fail');
  assert.equal(j('messages', 'owner', 2).verdict, 'by-design');
  assert.equal(j('payout_destinations', 'owner', 1).verdict, 'fail');
  assert.equal(j('some_new_table', 'global', 3).verdict, 'by-design');
  assert.equal(judge({ who: 'person-a', table: 'wallets', kind: 'owner', summary: { status: 500, code: 'XX000', count: null } }).verdict, 'fail');
});

test('verdicts: --gateway-only wants a refusal everywhere', () => {
  const j = (summary) => judge({ who: 'person-a', table: 'profiles', kind: 'owner', summary, gatewayOnly: true });
  assert.equal(j({ status: 403, code: '42501', count: null }).verdict, 'ok');
  assert.equal(j({ status: 200, code: null, count: 0 }).verdict, 'fail');
});

test('a failure line names the request and carries no key', () => {
  const line = describeRequest(readRequest(STAGING, 'wallets', 'user_id', ID), 'person-a');
  assert.match(line, /^GET \/rest\/v1\/wallets\?/);
  assert.match(line, /as person A/);
  assert.doesNotMatch(line, /apikey|Bearer|eyJ/i);
});

test('--dry-run exits 0 without a network, for staging and for a refused target', () => {
  const run = (url) => spawnSync(process.execPath, ['scripts/direct-door-test.mjs', '--dry-run'], {
    encoding: 'utf8', env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: '' },
  });
  const ok = run(STAGING);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /staging project, accepted/);
  assert.match(ok.stdout, /nothing was called/);
  const bad = run('https://taskdrop.in');
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /would refuse to run/);
});

test('a real run against another project is refused before anything is called', () => {
  const r = spawnSync(process.execPath, ['scripts/direct-door-test.mjs'], {
    encoding: 'utf8', env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: 'https://taskdrop.in', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'x' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to run/);
});
