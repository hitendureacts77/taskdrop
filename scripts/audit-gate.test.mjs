import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advisoriesIn, evaluate } from './audit-gate.mjs';

const NOW = Date.parse('2026-10-14T00:00:00Z');
const adv = (id, name, severity, title = 'a flaw') => ({ name, severity, title, range: '<=1.0.0', url: `https://github.com/advisories/${id}` });
/** A report shaped like `npm audit --json`: a vulnerable package, and one that is only affected through it. */
const report = (...vias) => ({
  vulnerabilities: {
    // Advisories for the same package share one entry, as npm audit reports them.
    ...Object.fromEntries(
      vias.reduce((entries, v) => {
        const entry = entries.get(v.name) ?? { name: v.name, severity: v.severity, via: [] };
        entry.via.push(v);
        entries.set(v.name, entry);
        return entries;
      }, new Map()),
    ),
    expo: { name: 'expo', severity: 'high', via: vias.map((v) => v.name) }, // only affected through the others
  },
});
const ok = (id, pkg, reviewBy = '2026-12-13') => ({ id, package: pkg, reason: 'no patched release', reviewBy });

test('advisories are read once each, ignoring packages that are only affected through another', () => {
  const r = report(adv('GHSA-aaaa-aaaa-aaaa', 'braces', 'high'), adv('GHSA-bbbb-bbbb-bbbb', 'uuid', 'moderate'));
  assert.deepEqual(advisoriesIn(r).map((a) => a.id).sort(), ['GHSA-aaaa-aaaa-aaaa', 'GHSA-bbbb-bbbb-bbbb']);
});

test('low severity is ignored, like --audit-level=moderate', () => {
  assert.equal(advisoriesIn(report(adv('GHSA-low0-low0-low0', 'x', 'low'))).length, 0);
});

test('a clean report passes', () => {
  const r = evaluate({ vulnerabilities: {} }, [], NOW);
  assert.deepEqual(r.failures, []);
});

test('a new advisory fails, and says which', () => {
  const r = evaluate(report(adv('GHSA-new0-new0-new0', 'lodash', 'high', 'prototype pollution')), [], NOW);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /New advisory.*lodash.*prototype pollution.*GHSA-new0-new0-new0/);
});

test('an excepted advisory with a reason and a future date is accepted', () => {
  const r = evaluate(report(adv('GHSA-aaaa-aaaa-aaaa', 'braces', 'high')), [ok('GHSA-aaaa-aaaa-aaaa', 'braces')], NOW);
  assert.deepEqual(r.failures, []);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].reviewBy, '2026-12-13');
});

test('an exception stops working on its review date', () => {
  const e = [ok('GHSA-aaaa-aaaa-aaaa', 'braces', '2026-10-13')];
  const r = evaluate(report(adv('GHSA-aaaa-aaaa-aaaa', 'braces', 'high')), e, NOW);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /expired on 2026-10-13/);
});

test('a critical advisory can never be excepted', () => {
  const r = evaluate(report(adv('GHSA-crit-crit-crit', 'shell-quote', 'critical')), [ok('GHSA-crit-crit-crit', 'shell-quote')], NOW);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /critical advisory cannot be excepted/);
});

test('an exception needs a reason and a real date', () => {
  const r1 = evaluate(report(adv('GHSA-aaaa-aaaa-aaaa', 'braces', 'high')), [{ id: 'GHSA-aaaa-aaaa-aaaa', package: 'braces', reason: '  ', reviewBy: '2026-12-13' }], NOW);
  assert.match(r1.failures[0], /no reason/);
  const r2 = evaluate(report(adv('GHSA-aaaa-aaaa-aaaa', 'braces', 'high')), [{ id: 'GHSA-aaaa-aaaa-aaaa', package: 'braces', reason: 'x', reviewBy: 'soon' }], NOW);
  assert.match(r2.failures[0], /valid reviewBy/);
});

test('an exception for an advisory that has gone is reported, not failed', () => {
  const r = evaluate({ vulnerabilities: {} }, [ok('GHSA-gone-gone-gone', 'old')], NOW);
  assert.deepEqual(r.failures, []);
  assert.equal(r.notices.length, 1);
  assert.match(r.notices[0], /GHSA-gone-gone-gone/);
  assert.match(r.notices[0], /no longer needed/);
});

test('one excepted advisory does not excuse a different new one in the same package', () => {
  const r = evaluate(
    report(adv('GHSA-aaaa-aaaa-aaaa', 'braces', 'high'), adv('GHSA-zzzz-zzzz-zzzz', 'braces', 'high', 'a second flaw')),
    [ok('GHSA-aaaa-aaaa-aaaa', 'braces')],
    NOW,
  );
  assert.equal(r.accepted.length, 1);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /GHSA-zzzz-zzzz-zzzz/);
});
