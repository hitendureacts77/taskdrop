// node --test scripts/lib/two-person.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEMO_ARGS, SKIPPED, cachePlan, differences, guestSharedOpNames, leaked, memoOpNames, memoProbes, neverReuseOpNames, opNames,
  phoneMarker, privateHits, probedOps, readOpNames, stateOf, strings, targetRefusal, uuidsByKey,
} from './two-person.mjs';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

test('the cache section refuses production and anything but the staging project', () => {
  assert.equal(targetRefusal('https://wjxvingpfbfvkfqhrguj.supabase.co'), null);
  for (const url of ['https://taskdrop.in', 'https://admin.taskdrop.in', 'https://www.taskdrop.in/x', 'https://api.taskdrop.in']) {
    assert.match(targetRefusal(url), /production/);
  }
  assert.match(targetRefusal('https://wjxvingpfbfvkfqhrguj.supabase.co.evil.example'), /not the staging/);
  assert.match(targetRefusal(undefined), /not set/);
  assert.match(targetRefusal('nope'), /not a URL/);
});

test('the shared, never-reused and guest lists are read from the source, and every shared read has arguments', () => {
  const memo = memoOpNames();
  assert.ok(memo.includes('trendingCategories') && memo.includes('adAuctionRanks'), memo.join(','));
  for (const op of memo) assert.ok(MEMO_ARGS[op], `${op} needs arguments in MEMO_ARGS`);
  const never = neverReuseOpNames();
  assert.ok(never.includes('getWallet') && never.includes('listPayoutDestinations'), never.join(','));
  for (const op of memo) assert.ok(!never.includes(op), `${op} is shared and never-reused at once`);
  assert.ok(guestSharedOpNames().includes('topEarners'));
  const probes = memoProbes();
  assert.ok(probes.some((p) => p.op === 'promotionTiers' && !p.guest), 'promotionTiers is for signed-in people only');
  assert.ok(cachePlan().length > 5);
});

test('a shared answer is checked for private keys and person markers, a top helper card id excepted', () => {
  const markers = { ids: [ID_A, ID_B], other: ['9990000001', 'asha@example.com'] };
  assert.deepEqual(privateHits('trendingCategories', [{ category: 'cleaning', open_count: 3 }], markers), []);
  assert.deepEqual(privateHits('topEarners', [{ id: ID_A, display_name: 'Meera' }], markers), []);
  assert.deepEqual(privateHits('topEarners', [{ id: ID_A, phone: '9990000001' }], markers).sort(), ['key phone', 'phone: 9990000001'].sort());
  assert.deepEqual(privateHits('topEarners', [{ id: 'x', poster_id: ID_B }], markers), [`poster_id: ${ID_B}`]);
  assert.deepEqual(privateHits('platformHighlights', { id: ID_A }, markers), [`id: ${ID_A}`]);
  assert.deepEqual(privateHits('platformHighlights', { note: 'mail ASHA@example.com' }, markers), ['note: asha@example.com']);
  assert.deepEqual(privateHits('promotionTiers', { nested: [{ balance_minor: 5 }] }, markers), ['key balance_minor']);
});

test('answers are compared byte for byte', () => {
  assert.equal(differences({ A: [{ a: 1 }], B: [{ a: 1 }], guest: [{ a: 1 }] }), null);
  assert.equal(differences({ A: [{ a: 1 }], B: [{ a: 2 }], guest: [{ a: 1 }] }), 'A differs from B');
  // Same content in another key order is not the same bytes, and counts as different.
  assert.equal(differences({ A: { x: 1, y: 2 }, B: { y: 2, x: 1 } }), 'A differs from B');
});

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
