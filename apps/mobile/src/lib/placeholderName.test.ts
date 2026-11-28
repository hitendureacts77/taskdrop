import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceholderName } from './placeholderName.ts';

test('made-up names are not offered; real ones are', () => {
  for (const n of ['Tasker 0077', 'tasker 1234', 'p9198000077', 'a@b.com', 'New user', '', null, undefined]) assert.equal(isPlaceholderName(n), true, String(n));
  for (const n of ['Asha', 'Tasker Rao', 'Ravi K']) assert.equal(isPlaceholderName(n), false, n);
});
