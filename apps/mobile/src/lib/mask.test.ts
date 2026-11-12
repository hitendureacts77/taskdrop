import test from 'node:test';
import assert from 'node:assert/strict';
import { findContactIssue, maskContacts } from './mask.ts';

test('ordinary words that start with snap are left alone', () => {
  for (const text of ['snap a photo of the meter', 'I can snap the old tiles off', 'Snapshot of the damage attached']) {
    assert.deepEqual(maskContacts(text), { text, masked: false });
  }
});

test('a Snapchat handle is still hidden, and still stops a post', () => {
  const r = maskContacts('add me on snapchat: ravi_fixes ok');
  assert.equal(r.masked, true);
  assert.ok(!r.text.includes('ravi_fixes'));
  assert.equal(findContactIssue('add me on snapchat'), 'handle');
});

test('the other chat apps are still hidden', () => {
  for (const text of ['whatsapp me on ravi', 'insta: ravi', 'telegram ravi99']) {
    assert.equal(maskContacts(text).masked, true, text);
  }
});

test('phone numbers and emails are still hidden', () => {
  assert.equal(maskContacts('call 98765 43210 now').masked, true);
  assert.equal(maskContacts('write to a@b.com').masked, true);
});
