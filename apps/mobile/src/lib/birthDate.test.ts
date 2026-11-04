import test from 'node:test';
import assert from 'node:assert/strict';
import { clampDay, daysInMonth, days, months, years } from './birthDate.ts';

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
  assert.equal(y[0].value, '2026');
  assert.equal(y[y.length - 1].value, '1920');
});
