import test from 'node:test';
import assert from 'node:assert/strict';
import { findContactIssue, maskContacts, offerIssueMessage, profileIssueMessage } from './mask.ts';

test('W2-2 / W2-21: the walk texts are refused, with the worker-side wording', () => {
  const offer = 'I can do it. Call me 9876543210 or mail a@b.com <script>x</script>';
  const issue = findContactIssue(offer);
  assert.ok(issue);
  assert.match(offerIssueMessage(issue!), /hired/);
  const worker = 'I fix things. WhatsApp me on 98765 43210 <script>alert(1)</script> emoji';
  assert.equal(findContactIssue(worker), 'phone');
  assert.match(profileIssueMessage('phone'), /phone number on your profile/);
  assert.equal(findContactIssue('I have fixed 40 taps and can start tomorrow morning.'), null);
});

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
