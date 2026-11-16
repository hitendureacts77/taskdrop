import test from 'node:test';
import assert from 'node:assert/strict';
import { clearingLine, nextClearDate } from './walletClearing.ts';

const money = (m: number) => `₹${m / 100}`;
const now = new Date(2026, 10, 18, 12, 0, 0); // 18 Nov 2026, local time
const earned = (day: number) => ({ kind: 'clearing', title: 'Earned', at: new Date(2026, 10, day, 9, 0, 0).toISOString() });

test('W3-3: nothing clearing, no line', () => {
  assert.equal(clearingLine({ clearingMinor: 0, rows: [], days: 7, now, money }), null);
});

test('W3-3: an earning from 16 Nov joins Available on 23 Nov', () => {
  const line = clearingLine({ clearingMinor: 9000, rows: [earned(16)], days: 7, now, money });
  assert.match(line ?? '', /₹90 you earned is still clearing/);
  assert.match(line ?? '', /from 23 Nov/);
  assert.match(line ?? '', /7 days after the work is approved/);
});

test('W3-3: with several earnings the earliest day is named; old ones already cleared are ignored', () => {
  const rows = [earned(17), earned(16), earned(1)];
  assert.equal(nextClearDate(rows, 7, now)?.getDate(), 23);
});

test('W3-3: without a known earning the line still names the period, no invented date', () => {
  const line = clearingLine({ clearingMinor: 9000, rows: [], days: 7, now, money });
  assert.match(line ?? '', /7 days after the customer approves/);
  assert.doesNotMatch(line ?? '', /Nov/);
});

test('W3-3: other row kinds do not set the date', () => {
  const rows = [{ kind: 'clearing', title: 'Paid for your time', at: earned(17).at }, { kind: 'payout', title: 'Earned', at: earned(17).at }];
  assert.equal(nextClearDate(rows, 7, now), null);
});

test('W3-3: one day is singular', () => {
  assert.match(clearingLine({ clearingMinor: 100, rows: [], days: 1, now, money }) ?? '', /1 day after/);
});
