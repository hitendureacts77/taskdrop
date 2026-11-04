// node --test scripts/check-lost-refusals.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { lostRefusals, readMigrations } from './check-lost-refusals.mjs';

const fn = (name, ...refusals) =>
  `create or replace function public.${name}(p int) returns void language plpgsql as $$ begin\n` +
  refusals.map((r) => `  if p < 0 then raise exception '${r}'; end if;\n`).join('') +
  'end; $$;\n';

test('no rewritten function in the migrations lost a refusal', () => {
  assert.deepEqual(lostRefusals(readMigrations()), []);
});

test('a rewrite that drops a refusal is caught, as 071 did to request_withdrawal', () => {
  const files = [
    { name: '066.sql', sql: fn('request_withdrawal', 'Enter an amount', 'The most you can withdraw at once is % rupees') },
    { name: '071.sql', sql: fn('request_withdrawal', 'Enter an amount', 'Your account is suspended') },
  ];
  assert.deepEqual(lostRefusals(files, new Map()).map((l) => l.refusal), ['The most you can withdraw at once is % rupees']);
});

test('adding refusals, or dropping one on purpose, passes', () => {
  const files = [
    { name: 'a.sql', sql: fn('f', 'One') + fn('g', 'Old') },
    { name: 'b.sql', sql: fn('f', 'One', 'Two') + fn('g', 'New') },
  ];
  assert.deepEqual(lostRefusals(files, new Map([['public.g: Old', 'replaced']])), []);
});

test('only the newest rewrite is judged, so history already fixed stays quiet', () => {
  const files = [
    { name: 'a.sql', sql: fn('f', 'One', 'Two') },
    { name: 'b.sql', sql: fn('f', 'One') },
    { name: 'c.sql', sql: fn('f', 'One', 'Two') },
  ];
  assert.deepEqual(lostRefusals(files, new Map()), []);
});
