/**
 * Turns whatever was typed or pasted into the 10 digits of an Indian mobile
 * number. "+91 98765 43210", "919876543210", "09876543210" and "98765 43210"
 * all become "9876543210". A country code or leading 0 is stripped only when
 * more than 10 digits were given, so a plain 10-digit number that happens to
 * start with 91 or 0 is left alone.
 */
export function normalizeMobileInput(text: string): string {
  let d = text.replace(/\D/g, '');
  if (d.length > 10) {
    if (d.startsWith('91') && d.length === 12) d = d.slice(2);
    else if (d.startsWith('0')) d = d.slice(1);
  }
  return d.slice(0, 10);
}

/** Exactly 10 digits, starting with 6-9 (the same rule the server applies). */
export function isReadyMobile(d: string): boolean {
  return /^[6-9]\d{9}$/.test(d);
}
