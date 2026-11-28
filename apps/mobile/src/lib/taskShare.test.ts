/**
 * Tests for a task's public link and share words (task 128). Run from the repo root:
 *   node --experimental-strip-types --test apps/mobile/src/lib/taskShare.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SHARE_ASK, STAGING_SITE, taskLink, taskShare } from './taskShare.ts';

test('taskLink: the website address /task/<id> from the origin', () => {
  assert.equal(taskLink('https://taskdrop.in', 'abc-123'), 'https://taskdrop.in/task/abc-123');
  assert.equal(taskLink('https://taskdrop.in/', 'abc'), 'https://taskdrop.in/task/abc');
  assert.equal(taskLink(STAGING_SITE, 'a b/c'), 'https://taskdrop.in/task/a%20b%2Fc');
});

test('taskLink: no link without a real origin or an id', () => {
  assert.equal(taskLink(null, 'abc'), null);
  assert.equal(taskLink('', 'abc'), null);
  assert.equal(taskLink('taskdrop.in', 'abc'), null);
  assert.equal(taskLink('javascript:alert(1)', 'abc'), null);
  assert.equal(taskLink('https://taskdrop.in/some/path', 'abc'), null);
  assert.equal(taskLink('https://taskdrop.in', ''), null);
  assert.equal(taskLink('https://taskdrop.in', null), null);
});

const rough = (label: string | null) => (label === 'Flat 402, Sai Residency, Madhapur, Hyderabad' ? 'Madhapur, Hyderabad' : label === 'Remote' ? 'Remote' : null);

test('taskShare: title, rough area, the ask and the link', () => {
  const s = taskShare({ id: 't1', title: 'Fix my kitchen tap', loc_label: 'Flat 402, Sai Residency, Madhapur, Hyderabad' }, 'https://taskdrop.in', rough);
  assert.deepEqual(s, {
    title: 'Fix my kitchen tap',
    message: `Fix my kitchen tap (Madhapur, Hyderabad)\n${SHARE_ASK}`,
    url: 'https://taskdrop.in/task/t1',
  });
  // Never the door-level address.
  assert.ok(!s!.message.includes('402') && !s!.message.includes('Sai Residency'));
});

test('taskShare: no area when there is none; no share without a link', () => {
  assert.equal(taskShare({ id: 't2', title: 'Logo design', loc_label: null }, 'https://taskdrop.in', rough)!.message, `Logo design\n${SHARE_ASK}`);
  assert.equal(taskShare({ id: 't3', title: 'Logo', loc_label: 'Remote' }, 'https://taskdrop.in', rough)!.message, `Logo (Remote)\n${SHARE_ASK}`);
  assert.equal(taskShare({ id: 't4', title: 'x' }, null, rough), null);
});
