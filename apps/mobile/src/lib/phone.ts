/**
 * Turns whatever was typed or pasted into the 10 digits of an Indian mobile
 * number. "+91 98765 43210", "919876543210", "09876543210" and "98765 43210"
 * all become "9876543210", whether pasted or typed one key at a time. A
 * country code or leading 0 is stripped only when more than 10 digits were
 * given, so a plain 10-digit number that happens to start with 91 or 0 is left
 * alone.
 */
export function normalizeMobileInput(text: string): string {
  let d = text.replace(/\D/g, '');
  if (d.length > 10) {
    // "0091 98880 77001", the international way of writing +91 (W2-8): drop the 0091, pasted or typed.
    if (d.startsWith('0091')) return d.slice(4, 14);
    // "+91 0 98765 43210": a stray 0 between the country code and the number (S6-6).
    if (d.length === 13 && d.startsWith('910')) return d.slice(3, 13);
    // 11 digits happens when "+91 98880 ..." is typed key by key (the box keeps only digits,
    // so the "+" is gone and the 11th key arrives after "91" + 9 digits): drop the 91, keep the key.
    if (d.startsWith('91') && (d.length === 12 || d.length === 11)) d = d.slice(2);
    else if (d.startsWith('0')) d = d.slice(1);
  }
  return d.slice(0, 10);
}

/** Exactly 10 digits, starting with 6-9 (the same rule the server applies). */
export function isReadyMobile(d: string): boolean {
  return /^[6-9]\d{9}$/.test(d);
}

/** "9876543210" -> "98765 43210", the way people say a number aloud. */
export function spacedMobile(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}
