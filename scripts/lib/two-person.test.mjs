// node --test scripts/lib/two-person.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { SKIPPED, leaked, opNames, phoneMarker, probedOps, readOpNames, stateOf, strings, uuidsByKey } from './two-person.mjs';

test('every api operation is probed unless it is skipped with a reason', () => {
  const all = opNames();
  assert.ok(all.length > 100, `found ${all.length} operations; the source layout changed`);
  const probed = probedOps();
  assert.equal(probed.length, all.length - Object.keys(SKIPPED).length);
  for (const [name, why] of Object.entries(SKIPPED)) assert.ok(why.length > 10, `${name} needs a reason`);
  assert.ok(probed.includes('getWallet') && probed.includes('requestWithdrawal') && probed.includes('taskContactPhone'));
});

test('reads and writes are told apart', () => {
  const reads = readOpNames();
  assert.ok(reads.has('getWallet') && !reads.has('requestWithdrawal'));
});

test('strings and uuids are found at any depth, with the key they sit under', () => {
  const doc = { rows: [{ id: '11111111-1111-4111-8111-111111111111', note: 'hello', nested: { taskId: '22222222-2222-4222-8222-222222222222' } }] };
  assert.deepEqual(strings(doc).sort(), ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'hello']);
  const by = uuidsByKey(doc);
  assert.deepEqual([...by.id], ['11111111-1111-4111-8111-111111111111']);
  assert.deepEqual([...by.taskId], ['22222222-2222-4222-8222-222222222222']);
});

test('a marker is found whatever its case, and clean text finds nothing', () => {
  assert.deepEqual(leaked('{"upi":"LeakTest123@okaxis"}', ['leaktest123@okaxis', '9990000001']), ['leaktest123@okaxis']);
  assert.deepEqual(leaked('{"ok":true}', ['leaktest123@okaxis', '']), []);
  assert.equal(phoneMarker('+91 99900 00001'), '9990000001');
});

test('the picture of a person\'s state changes when a task, a destination, the wallet or the notices change', () => {
  const base = { tasks: [{ id: 't1', status: 'open', title: 'x' }], destinations: [{ id: 'd1', upi_id: 'a@b' }], wallet: { balance: 5 }, notifications: [1, 2] };
  const same = stateOf(JSON.parse(JSON.stringify(base)));
  assert.equal(stateOf(base), same);
  assert.notEqual(stateOf({ ...base, tasks: [{ id: 't1', status: 'cancelled', title: 'x' }] }), same);
  assert.notEqual(stateOf({ ...base, destinations: [] }), same);
  assert.notEqual(stateOf({ ...base, wallet: { balance: 4 } }), same);
  assert.notEqual(stateOf({ ...base, notifications: [1] }), same);
});
