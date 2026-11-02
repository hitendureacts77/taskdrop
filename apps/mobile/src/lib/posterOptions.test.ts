import test from 'node:test';
import assert from 'node:assert/strict';
import { CREW_MAX, MAX_SUGGESTIONS, crewShareMinor, crewSizeFrom, looksLikePlaceQuestion, suggestOptions } from './posterOptions.ts';

const base = { text: '', whenNow: false, remote: false };

test('shifting a flat and cleaning the old one: crew, with the words used', () => {
  const s = suggestOptions({ ...base, text: 'Shift my 2BHK to Kondapur on Saturday and clean the old flat' });
  assert.deepEqual(s.map((x) => x.key), ['crew']);
  assert.match(s[0]!.reason, /Shift/);
});

test('only one suggestion: the poster\'s words win over the When step', () => {
  assert.equal(MAX_SUGGESTIONS, 1);
  const s = suggestOptions({ ...base, text: 'Shift and clean every week', whenNow: true });
  assert.deepEqual(s.map((x) => x.key), ['crew']);
  const now = suggestOptions({ ...base, text: 'Need 4 water cans brought up', whenNow: true });
  assert.deepEqual(now.map((x) => x.key), ['flash']);
});

test('nothing tied to a place for remote work', () => {
  const remote = suggestOptions({ ...base, text: 'Fix my website and move it to a new host', whenNow: true, remote: true });
  assert.deepEqual(remote.map((x) => x.key), []);
});

test('repeat, offer-first and photos are never suggested (owner, 2026-11-02)', () => {
  const keys = ['Ironing for the family', 'Need 4 water cans', 'Paint and clean the kitchen'].flatMap((text) =>
    suggestOptions({ ...base, text, whenNow: true }).map((x) => x.key),
  );
  assert.ok(!keys.some((k) => k === 'repeat' || k === 'regular' || k === 'photos'));
});

test('a question about a place right now looks like a Live answer', () => {
  assert.equal(looksLikePlaceQuestion('Is the queue at Passport Seva Kendra long right now?'), true);
  assert.equal(looksLikePlaceQuestion('Is Ratnadeep in Madhapur open'), true);
  assert.equal(looksLikePlaceQuestion('Clean my kitchen'), false);
  assert.equal(looksLikePlaceQuestion('What is a good logo for my shop?'), false);
});

test('a crew budget splits like the server: rounded down', () => {
  assert.equal(crewShareMinor(360000, 3), 120000);
  assert.equal(crewShareMinor(100000, 3), 33333);
});

test('a crew starts with the number of helpers the poster wrote, else 2, within 2 to 10', () => {
  assert.equal(crewSizeFrom('need 3 people to help shift my house on Saturday'), 3);
  assert.equal(crewSizeFrom('Four helpers for a wedding'), 4);
  assert.equal(crewSizeFrom('shift my 2BHK on Sunday'), 2);
  assert.equal(crewSizeFrom('1 person to move a sofa'), 2);
  assert.equal(crewSizeFrom('25 workers for an event'), CREW_MAX);
});
