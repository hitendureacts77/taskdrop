import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecent,
  closeMatchesLabel,
  countLabel,
  emptyTitle,
  loadingLine,
  parseRecent,
  suggestionCount,
} from './smartSearch.ts';

test('addRecent puts the newest first and drops repeats in any letter case', () => {
  assert.deepEqual(addRecent(['tap', 'logo'], 'Plumber'), ['Plumber', 'tap', 'logo']);
  assert.deepEqual(addRecent(['Plumber', 'tap', 'logo'], '  tap '), ['tap', 'Plumber', 'logo']);
  assert.deepEqual(addRecent(['Tap', 'logo'], 'tAP'), ['tAP', 'logo']);
});

test('addRecent keeps at most five and ignores empty or one-letter searches', () => {
  assert.deepEqual(addRecent(['a1', 'b1', 'c1', 'd1', 'e1'], 'f1'), ['f1', 'a1', 'b1', 'c1', 'd1']);
  assert.deepEqual(addRecent(['a1'], '   '), ['a1']);
  assert.deepEqual(addRecent(['a1'], 'x'), ['a1']);
  assert.deepEqual(addRecent(['a1'], 'x'.repeat(61)), ['a1']);
});

test('parseRecent tolerates bad storage', () => {
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent('not json'), []);
  assert.deepEqual(parseRecent('{"a":1}'), []);
  assert.deepEqual(parseRecent('["tap",3,"logo","TAP"]'), ['tap', 'logo']);
  assert.equal(parseRecent(JSON.stringify(['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1'])).length, 5);
});

test('emptyTitle names the first chip, or the query, with the area when there is one', () => {
  assert.equal(emptyTitle({ role: 'earn', chipLabel: 'Plumber', query: 'plumbr', km: 10 }), 'No plumber jobs within 10 km');
  assert.equal(emptyTitle({ role: 'hire', chipLabel: null, query: 'Tap Repair', km: 5 }), 'No tap repair helpers within 5 km');
  assert.equal(emptyTitle({ role: 'earn', chipLabel: 'Plumber', query: 'x', km: null }), 'No plumber jobs found');
  assert.equal(emptyTitle({ role: 'hire', query: 'logo' }), 'No logo helpers found');
});

test('suggestionCount, countLabel, closeMatchesLabel and loadingLine', () => {
  assert.equal(suggestionCount(14, true, true), '14 near you');
  assert.equal(suggestionCount(14, false, true), '14');
  assert.equal(suggestionCount(14, true, false), '14');
  assert.equal(suggestionCount(null, true, true), null);
  assert.equal(countLabel(1, 'earn'), '1 job');
  assert.equal(countLabel(14, 'earn'), '14 jobs');
  assert.equal(countLabel(1, 'hire'), '1 helper');
  assert.equal(closeMatchesLabel(['Plumbing', 'Taps']), 'Close matches: plumbing, taps');
  assert.equal(loadingLine('hire'), 'Finding helpers that match what you mean…');
});
