import test from 'node:test';
import assert from 'node:assert/strict';
import { CREW_MAX, MAX_SUGGESTIONS, crewShareMinor, crewSizeFrom, looksLikePlaceQuestion, suggestOptions } from './posterOptions.ts';

const base = { text: '', whenNow: false, remote: false, postedBefore: 0, regular: null };

test('shifting a flat and cleaning the old one: crew, then photos, each with the words used', () => {
  const s = suggestOptions({ ...base, text: 'Shift my 2BHK to Kondapur on Saturday and clean the old flat' });
  assert.deepEqual(s.map((x) => x.key), ['crew', 'photos']);
  assert.match(s[0]!.reason, /Shift/);
  assert.match(s[1]!.reason, /clean/);
});

test('water cans now, posted before, hired someone: flash, regular, repeat', () => {
  const s = suggestOptions({
    ...base,
    text: 'Need 4 water cans brought up to my flat',
    whenNow: true,
    postedBefore: 3,
    regular: { id: 'r', name: 'Ravi K.' },
  });
  assert.deepEqual(s.map((x) => x.key), ['flash', 'regular', 'repeat']);
  assert.equal(s[2]!.reason, 'You posted this 3 times before');
});

test('never more than three, and nothing tied to a place for remote work', () => {
  const s = suggestOptions({
    ...base,
    text: 'Shift and clean every week',
    whenNow: true,
    postedBefore: 1,
    regular: { id: 'r', name: 'A' },
  });
  assert.equal(s.length, MAX_SUGGESTIONS);
  const remote = suggestOptions({ ...base, text: 'Fix my website and move it to a new host', whenNow: true, remote: true });
  assert.deepEqual(remote.map((x) => x.key), []);
});

test('everyday words suggest Repeat even the first time', () => {
  assert.deepEqual(suggestOptions({ ...base, text: 'Ironing for the family' }).map((x) => x.key), ['repeat']);
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
