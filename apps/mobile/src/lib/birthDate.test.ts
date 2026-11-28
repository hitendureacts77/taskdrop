import test from 'node:test';
import assert from 'node:assert/strict';
import { birthDateProblem, clampDay, daysInMonth, days, indiaYear, months, years } from './birthDate.ts';

test('W2-7: a future birth date says so; a real non-date says it does not exist', () => {
  const today = new Date('2026-11-16T10:00:00');
  assert.equal(birthDateProblem({ day: '1', month: '12', year: '2026' }, today), 'Your birth date can’t be in the future.');
  assert.equal(birthDateProblem({ day: '31', month: '12', year: '2026' }, today), 'Your birth date can’t be in the future.');
  assert.equal(birthDateProblem({ day: '30', month: '2', year: '2001' }, today), 'That date does not exist. Check the day.');
  assert.equal(years(today)[0].value, '2008');
});

test('30 and 31 day months', () => {
  for (const m of ['4', '6', '9', '11']) assert.equal(daysInMonth(m, '2001'), 30, m);
  for (const m of ['1', '3', '5', '7', '8', '10', '12']) assert.equal(daysInMonth(m, '2001'), 31, m);
});

test('no month allows 31', () => {
  assert.equal(daysInMonth('', ''), 31);
  assert.equal(daysInMonth('', '2000'), 31);
});

test('February is 29 while the year is empty, then follows the leap rule', () => {
  assert.equal(daysInMonth('2', ''), 29);
  assert.equal(daysInMonth('2', '2001'), 28);
  assert.equal(daysInMonth('2', '2000'), 29);
  assert.equal(daysInMonth('2', '1900'), 28);
  assert.equal(daysInMonth('2', '2024'), 29);
});

test('clamping a day into the month', () => {
  assert.equal(clampDay('31', '4', '2001'), '30');
  assert.equal(clampDay('31', '2', '2001'), '28');
  assert.equal(clampDay('30', '2', '2000'), '29');
  assert.equal(clampDay('29', '2', ''), '29');
  assert.equal(clampDay('29', '2', '1900'), '28');
  assert.equal(clampDay('15', '2', '2001'), '15');
  assert.equal(clampDay('31', '', ''), '31');
  assert.equal(clampDay('', '2', '2001'), '');
});

test('option lists', () => {
  assert.equal(days().length, 31);
  assert.equal(months()[0].label, 'January');
  assert.equal(months()[11].value, '12');
  const y = years(new Date('2026-11-04'));
  assert.equal(y[0].value, '2008');
  assert.equal(y[y.length - 1].value, '1920');
});

test('the year list starts at the latest year that can pass 18+, by the India date', () => {
  assert.equal(years(new Date('2026-11-28T10:00:00Z'))[0].value, '2008');
  // 19:00 UTC on 31 Dec is already 1 Jan in India
  assert.equal(indiaYear(new Date('2026-12-31T19:00:00Z')), 2027);
  assert.equal(years(new Date('2026-12-31T19:00:00Z'))[0].value, '2009');
  assert.equal(years(new Date('2026-12-31T18:00:00Z'))[0].value, '2008');
});
