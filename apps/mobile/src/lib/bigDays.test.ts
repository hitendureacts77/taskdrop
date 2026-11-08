import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENTS,
  MAX_PLANS,
  addDays,
  bigDayParam,
  buildItems,
  dayKey,
  itemDay,
  longDay,
  newPlan,
  parseDay,
  parsePlans,
  postPrompt,
  shortDay,
  stateFor,
  tickedCount,
  whenLabel,
  withPlan,
  withPosted,
  withoutPlan,
  withoutPosted,
} from './bigDays.ts';

test('dates: keys round-trip and reject impossible days', () => {
  assert.equal(dayKey(new Date(2026, 11, 15)), '2026-12-15');
  assert.equal(parseDay('2026-12-15')?.getDate(), 15);
  assert.equal(parseDay('2026-02-30'), null);
  assert.equal(parseDay('15 Dec'), null);
  assert.equal(parseDay(undefined), null);
});

test('dates: offsets cross month and year ends', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});

test('dates: labels are the ones on the drawing', () => {
  assert.equal(longDay('2026-12-15'), 'Tue, 15 Dec');
  assert.equal(shortDay('2026-12-13'), 'Sun 13 Dec');
});

test('every event has 4 to 8 lines, a mix that makes sense, and unique ids', () => {
  assert.equal(EVENTS.length, 8);
  assert.equal(EVENTS[1]!.key, 'birthday');
  for (const e of EVENTS) {
    assert.ok(e.lines.length >= 4 && e.lines.length <= 8, `${e.key} has ${e.lines.length} lines`);
    const items = buildItems(e.key);
    assert.equal(new Set(items.map((i) => i.id)).size, items.length);
    for (const i of items) assert.ok(i.title.length >= 5 && i.title.length <= 80);
  }
});

test('the list asks for no prices anywhere', () => {
  const money = /₹|\brs\.?\b|rupee|price|cost|cheap|budget|\d{3,}/i;
  for (const e of EVENTS) {
    assert.doesNotMatch(`${e.label} ${e.dayLabel}`, money);
    for (const l of e.lines) assert.doesNotMatch(l.title, money, l.title);
  }
});

test('items start ticked, except any-day lines', () => {
  const moving = buildItems('moving');
  assert.equal(moving.length, 6);
  for (const i of moving) assert.equal(i.on, i.offset !== null, i.title);
  assert.equal(moving.find((i) => i.title === 'Help changing my address')?.kind, 'online');
  assert.equal(tickedCount({ items: moving }), 5);
});

test('moving house matches the drawing: offsets around the day', () => {
  const day = '2026-12-15';
  const today = '2026-11-07';
  const byTitle = (t: string) => buildItems('moving').find((i) => i.title === t)!;
  assert.equal(itemDay(day, byTitle('Deep clean the new flat').offset, today), '2026-12-13');
  assert.equal(itemDay(day, byTitle('Packing help, 2 people').offset, today), '2026-12-14');
  assert.equal(itemDay(day, byTitle('Fit fans and the geyser').offset, today), '2026-12-15');
  assert.equal(itemDay(day, byTitle('Deep clean the old flat').offset, today), '2026-12-16');
  assert.equal(itemDay(day, byTitle('Move my internet connection').offset, today), '2026-12-10');
  assert.equal(itemDay(day, byTitle('Help changing my address').offset, today), null);
});

test('a line never lands before today', () => {
  assert.equal(itemDay('2026-11-09', -5, '2026-11-07'), '2026-11-07');
  assert.equal(itemDay('2026-11-07', 0, '2026-11-07'), '2026-11-07');
  assert.equal(whenLabel('2026-11-09', { offset: null }, '2026-11-07'), 'Any day');
  assert.equal(whenLabel('2026-12-15', { offset: -2 }, '2026-11-07'), 'Sun 13 Dec');
});

test('the writer prompt carries the title and day, never an amount', () => {
  const plan = newPlan('p1', 'moving', '2026-12-15', 1);
  const clean = plan.items[1]!;
  assert.equal(postPrompt(plan, clean, '2026-11-07'), 'Deep clean the new flat on Sun 13 Dec');
  const anyDay = plan.items.find((i) => i.offset === null)!;
  assert.equal(postPrompt(plan, anyDay, '2026-11-07'), 'Help changing my address');
});

test('bigDayParam accepts only both ids as strings', () => {
  assert.deepEqual(bigDayParam({ planId: 'p1', itemId: 'i2' }), { planId: 'p1', itemId: 'i2' });
  assert.equal(bigDayParam({ planId: 'p1' }), null);
  assert.equal(bigDayParam({ planId: '', itemId: 'i' }), null);
  assert.equal(bigDayParam('p1'), null);
  assert.equal(bigDayParam(null), null);
});

test('store: keeps at most three plans, newest first', () => {
  let list = [] as ReturnType<typeof parsePlans>;
  for (let n = 1; n <= 4; n++) list = withPlan(list, newPlan(`p${n}`, 'festival', '2026-12-15', n));
  assert.equal(list.length, MAX_PLANS);
  assert.deepEqual(list.map((p) => p.id), ['p4', 'p3', 'p2']);
});

test('store: saving a plan with the same id replaces it', () => {
  const a = newPlan('p1', 'moving', '2026-12-15', 1);
  const list = withPlan(withPlan([], a), { ...a, day: '2026-12-20' });
  assert.equal(list.length, 1);
  assert.equal(list[0]!.day, '2026-12-20');
});

test('store: records the task a line became, once', () => {
  const a = newPlan('p1', 'moving', '2026-12-15', 1);
  let list = withPosted([a], 'p1', 'i1', 'task-9');
  assert.equal(list[0]!.items[1]!.taskId, 'task-9');
  list = withPosted(list, 'p1', 'i1', 'task-10');
  assert.equal(list[0]!.items[1]!.taskId, 'task-9');
  assert.equal(withPosted(list, 'nope', 'i1', 'x')[0]!.items[1]!.taskId, 'task-9');
  list = withoutPosted(list, 'p1', 'i1');
  assert.equal('taskId' in list[0]!.items[1]!, false);
});

test('store: deleting a plan removes only that plan', () => {
  const list = withPlan(withPlan([], newPlan('p1', 'moving', '2026-12-15', 1)), newPlan('p2', 'baby', '2027-01-10', 2));
  assert.deepEqual(withoutPlan(list, 'p1').map((p) => p.id), ['p2']);
});

test('store: what is read back is checked, and bad data is dropped', () => {
  const good = newPlan('p1', 'wedding', '2026-12-15', 5);
  const back = parsePlans(JSON.stringify([good, { id: 'x', event: 'nope', day: '2026-12-15', items: [] }, 7, null]));
  assert.equal(back.length, 1);
  assert.deepEqual(back[0], good);
  assert.deepEqual(parsePlans('not json'), []);
  assert.deepEqual(parsePlans('{"a":1}'), []);
  assert.deepEqual(parsePlans(null), []);
  const badDay = { ...good, day: '2026-13-40' };
  assert.deepEqual(parsePlans(JSON.stringify([badDay])), []);
  const badItem = { ...good, items: [{ id: 'i0', title: '  ', offset: 0, kind: 'person', on: true }, { id: 'i1', title: 'ok', offset: 1.5, kind: 'person', on: true }] };
  assert.deepEqual(parsePlans(JSON.stringify([badItem])), []);
});

test('status words follow the real task', () => {
  assert.equal(stateFor(undefined, undefined), 'not_posted');
  assert.equal(stateFor('t', 'OPEN'), 'posted');
  assert.equal(stateFor('t', undefined), 'posted');
  assert.equal(stateFor('t', 'LOCKED'), 'hired');
  assert.equal(stateFor('t', 'TASK_STARTED'), 'hired');
  assert.equal(stateFor('t', 'WORK_DONE'), 'hired');
  assert.equal(stateFor('t', 'COMPLETED'), 'done');
  assert.equal(stateFor('t', 'AUTO_COMPLETED'), 'done');
  assert.equal(stateFor('t', 'CANCELLED'), 'cancelled');
});
