import { MIN_SIGNUP_AGE } from '@taskdrop/rules';

export type BirthDateParts = { day: string; month: string; year: string };

export const EMPTY_BIRTH_DATE: BirthDateParts = { day: '', month: '', year: '' };

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type BirthDateItem = { value: string; label: string };

export function days(): BirthDateItem[] {
  return Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
}
export function months(): BirthDateItem[] {
  return MONTHS.map((label, i) => ({ value: String(i + 1), label }));
}
/** The calendar year in India right now (the server counts age on the India date, so after 18:30 UTC it is already tomorrow there). */
export function indiaYear(now = new Date()): number {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCFullYear();
}

/**
 * Newest first, starting at the latest year that can still pass the 18+ rule (2008 in 2026), so nobody scrolls
 * past years that are always refused. The server still checks the age itself (record_birth_date).
 */
export function years(now = new Date(), minAge = MIN_SIGNUP_AGE): BirthDateItem[] {
  const top = indiaYear(now) - minAge;
  return Array.from({ length: top - 1920 + 1 }, (_, i) => ({ value: String(top - i), label: String(top - i) }));
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * How many days the chosen month has. With no month, any day to 31 is allowed.
 * With no year yet, February keeps 29 so a leap-day birthday can still be picked.
 */
export function daysInMonth(month: string, year: string): number {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return 31;
  if (m === 2) {
    const y = Number(year);
    if (!year || !Number.isInteger(y)) return 29;
    return isLeap(y) ? 29 : 28;
  }
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/**
 * The line under the birth date once all three parts are chosen (W2-7): a real date after today is "in the
 * future", not "does not exist". Only used when parseBirthDate refused the date.
 */
export function birthDateProblem(parts: BirthDateParts, today = new Date()): string {
  const d = Number(parts.day);
  const m = Number(parts.month);
  const y = Number(parts.year);
  if ([d, m, y].every(Number.isInteger) && d >= 1 && m >= 1 && m <= 12 && d <= daysInMonth(parts.month, parts.year)) {
    const at = Date.UTC(y, m - 1, d);
    if (at > Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) return 'Your birth date can’t be in the future.';
  }
  return 'That date does not exist. Check the day.';
}

/** Keep the day inside the month: 31 becomes 30 or 28 when the month or year changes. */
export function clampDay(day: string, month: string, year: string): string {
  const d = Number(day);
  if (!day || !Number.isInteger(d)) return day;
  const max = daysInMonth(month, year);
  return d > max ? String(max) : day;
}
