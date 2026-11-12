import test from 'node:test';
import assert from 'node:assert/strict';
import { taskPageView } from './taskView.ts';

test('Earn mode is always the request view with the offer box', () => {
  for (const kind of ['request', 'service', null, undefined] as const) {
    assert.deepEqual(taskPageView('worker', kind), { asRequest: true, panel: 'offer' });
  }
});

test('Hire mode on a request shows a request, with the switch-to-Earn card', () => {
  assert.deepEqual(taskPageView('poster', 'request'), { asRequest: true, panel: 'switchToEarn' });
});

test('Hire mode on a service keeps the Hire view', () => {
  assert.deepEqual(taskPageView('poster', 'service'), { asRequest: false, panel: 'sendTask' });
});

test('Hire mode with the kind not loaded yet keeps the Hire view', () => {
  assert.deepEqual(taskPageView('poster', undefined), { asRequest: false, panel: 'sendTask' });
  assert.deepEqual(taskPageView('poster', null), { asRequest: false, panel: 'sendTask' });
});
