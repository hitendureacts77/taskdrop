import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SECURITY_REPORT_PROMISES, SECURITY_REPORT_RULES, securityReportContact } from './securityReports.ts';

test('the rules and promises say what the plan promised', () => {
  const rules = SECURITY_REPORT_RULES.join(' ');
  for (const word of ['test', 'another person', 'floods', 'Razorpay', 'before you tell anyone']) assert.ok(rules.includes(word), word);
  const promises = SECURITY_REPORT_PROMISES.join(' ');
  assert.ok(promises.includes('3 working days'));
  assert.ok(promises.includes('legal action'));
  assert.ok(promises.includes('thank-you list'));
});

test('the contact line names the address, or the in-app route when none is set', () => {
  assert.match(securityReportContact('help@example.in'), /help@example\.in/);
  assert.match(securityReportContact(null), /Help & support/);
});
