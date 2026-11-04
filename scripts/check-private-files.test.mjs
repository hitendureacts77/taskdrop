// node --test scripts/check-private-files.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { problems } from './check-private-files.mjs';
import { urlExpiry } from '../supabase/functions/_shared/imagekit.ts';

const MEDIA = "form.append('isPrivateFile', 'true');";
const API = 'if (details.isPrivateFile !== true) throw 1; const SIGNED_URL_SECONDS = 60 * 60;';
const base = { 'apps/mobile/src/lib/media.ts': MEDIA, 'supabase/functions/api/media.ts': API, code: [], migrations: [] };

test('the repository today keeps every file private', () => {
  assert.deepEqual(problems(), []);
});

test('an upload that stops saying private, or a server that stops checking, is caught', () => {
  assert.equal(problems({ ...base, 'apps/mobile/src/lib/media.ts': "form.append('isPrivateFile', 'false');" }).length, 1);
  assert.equal(problems({ ...base, 'supabase/functions/api/media.ts': 'const SIGNED_URL_SECONDS = 60 * 60;' }).length, 1);
});

test('a public link, a public bucket or a long-lived link is caught', () => {
  assert.equal(problems({ ...base, code: [['a.ts', 'storage.from(b).getPublicUrl(p)']] }).length, 1);
  assert.equal(problems({ ...base, migrations: [['m.sql', "insert into storage.buckets (id, name, public) values ('x', 'x', true);"]] }).length, 1);
  assert.equal(problems({ ...base, migrations: [['m.sql', "update storage.buckets set public = true where id = 'x';"]] }).length, 1);
  assert.equal(problems({ ...base, migrations: [['m.sql', "insert into storage.buckets (id, name, public) values ('x', 'x', false);"]] }).length, 0);
  assert.equal(problems({ ...base, 'supabase/functions/api/media.ts': API.replace('60 * 60', '24 * 60 * 60') }).length, 1);
});

test('an ImageKit link stops working between one and two hours after it is made', () => {
  for (const now of [0, 1_800_000, 3_599_000, 3_600_000, 7_199_000, 1_700_000_123_456]) {
    const left = urlExpiry(now) - now / 1000;
    assert.ok(left > 3600 && left <= 7200, `${left}s left at ${now}`);
  }
});
