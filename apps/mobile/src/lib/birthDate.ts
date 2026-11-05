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
/** Newest first: most people are born in the last 20 to 40 years, so the swipe is short. */
export function years(now = new Date()): BirthDateItem[] {
  const top = now.getFullYear();
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

/** Keep the day inside the month: 31 becomes 30 or 28 when the month or year changes. */
export function clampDay(day: string, month: string, year: string): string {
  const d = Number(day);
  if (!day || !Number.isInteger(d)) return day;
  const max = daysInMonth(month, year);
  return d > max ? String(max) : day;
}
