import test from 'node:test';
import assert from 'node:assert/strict';
import { whenFromText } from './whenFromText.ts';
import { askBrief, dueFor } from './taskBrief.ts';

test('picks the choice the request names', () => {
  assert.equal(whenFromText('Fix my leaking tap this weekend'), 'weekend');
  assert.equal(whenFromText('Need a cook on Saturday'), 'weekend');
  assert.equal(whenFromText('Clean my flat tomorrow'), '2days');
  assert.equal(whenFromText('Deliver a parcel today'), 'today');
  assert.equal(whenFromText('aaj tap theek karna hai'), 'today');
  assert.equal(whenFromText('repu painter kavali'), '2days');
});
test('earliest day word wins; none means null', () => {
  assert.equal(whenFromText('today or tomorrow is fine'), 'today');
  assert.equal(whenFromText('Fix my leaking tap'), null);
  assert.equal(whenFromText('sundaresan needs help'), null);
});
test('this weekend closes on a Sunday', () => {
  const d = dueFor('weekend', new Date(2026, 10, 25, 10)); // Wed
  assert.equal(d.getDay(), 0);
  assert.equal(d.getHours(), 21);
});
test('job size sets difficulty', () => {
  const d = (a: string) => askBrief('Fix my leaking tap', [{ question: 'How big is the job?', answer: a }], 'professional').difficulty;
  assert.equal(d('Small, under an hour'), 'easy');
  assert.equal(d('Medium, a few hours'), 'medium');
  assert.equal(d('Large, most of a day or more'), 'hard');
});
